// src/core/services/firebase/user/UserService.ts
import {
    doc,
    getDoc,
    updateDoc,
    runTransaction
  } from 'firebase/firestore';
  import { httpsCallable } from 'firebase/functions';
  import BaseFirebaseService from '../core/BaseFirebaseService';
  import {
    UserProfile,
    GroupUserProfile,
    UsernameValidationResult
  } from '../../../types/user';
  
  /**
   * UserService handles user profile operations, both global and group-specific
   */
  class UserService extends BaseFirebaseService {
    private static instance: UserService;
  
    private constructor() {
      super();
    }
  
    /**
     * Get singleton instance of UserService
     */
    public static getInstance(): UserService {
      if (!UserService.instance) {
        UserService.instance = new UserService();
      }
      return UserService.instance;
    }
  
    /**
     * Get a user's global profile
     * @param userId ID of the user
     * @returns Global user profile or null if not found
     */
    public async getUserProfile(userId: string): Promise<UserProfile | null> {
        const userDoc = await getDoc(doc(this.db, 'users', userId));
        
        if (userDoc.exists()) {
            const userData = userDoc.data();
            return {
            id: userId,
            email: userData.email || '',
            activeGroupId: userData.activeGroupId || null,
            lastLogin: userData.lastLogin || new Date(),
            createdAt: userData.createdAt || new Date(),
            // Account-scoped preferences (theme lives here). This mapping is
            // field-by-field rather than a spread, so anything not named here
            // is silently dropped on the way out of Firestore -- which is what
            // happened to `preferences`: the theme was written to the account
            // correctly and then never read back, so every load behaved as if
            // the account had no theme and re-migrated the stale group value
            // over it.
            preferences: userData.preferences || undefined
            };
        }
        
        return null;
        }
  
    /**
     * Update a user's global profile
     * @param userId ID of the user
     * @param updates Partial profile data to update
     */
    public async updateUserProfile(userId: string, updates: Partial<UserProfile>): Promise<void> {
      await updateDoc(doc(this.db, 'users', userId), updates);
    }
  
    /**
     * Get a user's profile in a specific group
     * @param groupId ID of the group
     * @param userId ID of the user
     * @returns Group-specific user profile or null if not found
     */
    public async getGroupUserProfile(groupId: string, userId: string): Promise<GroupUserProfile | null> {
      const profile = await this.readGroupProfile(groupId, userId);

      if (profile) {
        return {
          ...profile,
          userId
        } as GroupUserProfile;
      }
      
      return null;
    }

    /**
     * A user's profile in a group for display only -- a name beside some
     * content -- from the services' cache when it was read in the last few
     * minutes (T032, `PERF-09`). Never for decisions: those use
     * `getGroupUserProfile`, which always reads.
     *
     * @param groupId ID of the group
     * @param userId ID of the user
     * @returns Group-specific user profile or null if not found
     */
    public async getCachedGroupUserProfile(groupId: string, userId: string): Promise<GroupUserProfile | null> {
      const profile = await this.cachedGroupProfile(groupId, userId);
      return profile ? ({ ...profile, userId } as GroupUserProfile) : null;
    }
  
    /**
     * Update a user's profile in a specific group
     * @param groupId ID of the group
     * @param userId ID of the user
     * @param updates Object with fields to update
     */
    public async updateGroupUserProfile(groupId: string, userId: string, updates: Partial<GroupUserProfile>): Promise<void> {
      const docRef = doc(this.db, 'groups', groupId, 'users', userId);
      await updateDoc(docRef, updates);
      this.forgetGroupProfile(groupId, userId);
    }
  
    /**
     * Validate a username format and check availability in a group
     * @param groupId ID of the group to check in
     * @param username Username to validate
     * @returns Validation result object
     */
    public async validateGroupUsername(groupId: string, username: string): Promise<UsernameValidationResult> {
      // Check username format first
      const usernameRegex = /^[a-zA-Z0-9æøåÆØÅ_-]{3,20}$/;
      if (!usernameRegex.test(username)) {
        return {
          isValid: false,
          error: 'Allowed characters: a-z, æ, ø, å, 0-9, _ and -'
        };
      }
      
      try {
        // Check availability in group
        const isAvailable = await this.isUsernameAvailableInGroup(groupId, username);
        
        if (!isAvailable) {
          // Return a specific error for taken usernames
          return {
            isValid: true,
            isAvailable: false,
            error: 'Username already taken'
          };
        }
        
        // Username is valid and available
        return {
          isValid: true,
          isAvailable: true
        };
      } catch (err) {
        return {
          isValid: false,
          error: 'Error checking username availability'
        };
      }
    }
  
    /**
     * Check if a username is available in a specific group
     * @param groupId ID of the group to check in
     * @param username Username to check
     * @returns True if username is available, false otherwise
     */
    public async isUsernameAvailableInGroup(groupId: string, username: string): Promise<boolean> {
      const usernameLower = username.toLowerCase();
      const usernameDoc = await getDoc(doc(this.db, 'groups', groupId, 'usernames', usernameLower));
      return !usernameDoc.exists();
    }
  
    /**
     * Change a user's username in a specific group
     * @param groupId ID of the group
     * @param userId ID of the user
     * @param newUsername New username to set
     */
    public async changeGroupUsername(groupId: string, userId: string, newUsername: string): Promise<void> {
      // Validate username is available in this group
      const isAvailable = await this.isUsernameAvailableInGroup(groupId, newUsername);
      if (!isAvailable) {
        throw new Error('Username is already taken in this group');
      }
      
      // Get current username to delete after successful change
      const userDoc = await getDoc(doc(this.db, 'groups', groupId, 'users', userId));
      if (!userDoc.exists()) {
        throw new Error('User profile not found in this group');
      }
      
      const userData = userDoc.data() as GroupUserProfile;
      const currentUsername = userData.username;
      const currentUsernameLower = currentUsername.toLowerCase();
      
      // Don't proceed if username isn't actually changing (case-insensitive check)
      const newUsernameLower = newUsername.toLowerCase();
      if (newUsernameLower === currentUsernameLower) {
        return;
      }
      
      // Execute as a transaction to ensure atomicity
      await runTransaction(this.db, async (transaction) => {
        // Reserve new username
        const newUsernameDocRef = doc(this.db, 'groups', groupId, 'usernames', newUsernameLower);
        const newUsernameSnapshot = await transaction.get(newUsernameDocRef);
        
        if (newUsernameSnapshot.exists()) {
          throw new Error('Username is already taken in this group');
        }

        // Read before any write, as a transaction requires. A rename made by
        // the profile editor before T080 wrote the name without reserving it,
        // so the old name may be unreserved -- deleting it then is refused by
        // the rules -- or reserved to somebody else.
        const oldUsernameDocRef = doc(this.db, 'groups', groupId, 'usernames', currentUsernameLower);
        const oldUsernameSnapshot = await transaction.get(oldUsernameDocRef);

        // Update user profile
        const userDocRef = doc(this.db, 'groups', groupId, 'users', userId);
        transaction.update(userDocRef, {
          username: newUsername
        });
        
        // Create new username reservation
        transaction.set(newUsernameDocRef, {
          userId,
          originalUsername: newUsername,
          createdAt: new Date()
        });
        
        // Release the old name, only if it is this user's to release
        if (oldUsernameSnapshot.exists() && oldUsernameSnapshot.data().userId === userId) {
          transaction.delete(oldUsernameDocRef);
        }
      });
      this.forgetGroupProfile(groupId, userId);
}
  
    /**
     * Find a user by username in a group
     * @param groupId ID of the group
     * @param username Username to search for
     * @returns User ID if found, null otherwise
     */
    public async findUserByUsername(groupId: string, username: string): Promise<string | null> {
      const usernameLower = username.toLowerCase();
      const usernameDoc = await getDoc(doc(this.db, 'groups', groupId, 'usernames', usernameLower));
      
      if (usernameDoc.exists()) {
        const data = usernameDoc.data();
        return data.userId;
      }
      
      return null;
    }
  
    /**
     * Check if a user is an admin of a group
     * @param groupId ID of the group
     * @param userId ID of the user
     * @returns Whether the user is an admin
     */
    public async isUserAdmin(groupId: string, userId: string): Promise<boolean> {
      const profileData = await this.getGroupUserProfile(groupId, userId);
      return profileData?.role === 'admin';
    }

    /**
     * Delete the caller's account and everything owned by it.
     *
     * Goes through the `deleteUser` Cloud Function because Firestore cannot
     * cascade-delete subcollections from a client, and through `this.functions`
     * because that is the instance bound to `europe-west1`, where every function
     * in this project is deployed. A bare `getFunctions()` resolves `us-central1`
     * and reaches nothing -- and in development it also misses the emulator, which
     * `BaseFirebaseService` wires to the regioned instance only.
     *
     * @param userId UID to delete; the function deletes only the caller's
     *   own account
     */
    public async deleteAccount(userId: string): Promise<void> {
      try {
        const deleteUserFn = httpsCallable(this.functions, 'deleteUser');
        await deleteUserFn({ userId });
      } catch (err) {
        console.error('Error deleting account:', err);
        throw err;
      }
    }
  }
  
  export default UserService;