// src/core/services/firebase/group/GroupService.ts
import { 
    collection, 
    collectionGroup,
    doc, 
    getDoc, 
    getDocs, 
    onSnapshot,
    query,
    updateDoc,
    where,
    type Unsubscribe
  } from 'firebase/firestore';
import BaseFirebaseService from '../core/BaseFirebaseService';
import ServiceRegistry from '../core/ServiceRegistry';
import type UserService from '../user/UserService';
import { CreateGroupInput, Group } from '../../../types/user';
import { StoredImage } from '../../../types/storedImage';
import { assertTextFits } from '../data/TextTooLongError';
import { NAMED_DOCUMENT_TEXT_LIMITS } from '../../../constants/textLimits';
import { httpsCallable } from 'firebase/functions';

  /**
   * When a group profile says its member joined, in milliseconds, for putting
   * groups in the order they were joined. The functions store a Timestamp, the
   * dev sample data a date string; anything else sorts last.
   *
   * @param value The profile's `joinedAt`
   * @returns Its time, or Infinity
   */
  function joinedAt(value: unknown): number {
    if (value && typeof (value as { toMillis?: unknown }).toMillis === 'function') {
      return (value as { toMillis: () => number }).toMillis();
    }
    const time = typeof value === 'string' || value instanceof Date ? new Date(value).getTime() : NaN;
    return Number.isNaN(time) ? Infinity : time;
  }

  /**
   * GroupService manages group operations
   */
  class GroupService extends BaseFirebaseService {
    private static instance: GroupService;
    private userService: UserService;
  
    private constructor() {
      super();
      this.userService = ServiceRegistry.getInstance().get('userService');
    }
  
    /**
     * Get singleton instance of GroupService
     */
    public static getInstance(): GroupService {
      if (!GroupService.instance) {
        GroupService.instance = new GroupService();
      }
      return GroupService.instance;
    }
  
    /**
     * Create a new group
     *
     * Delegates to the `createGroup` Cloud Function: the group creator's own
     * profile is written with `role: 'admin'`, and production Firestore rules
     * deny clients that write entirely (bug #1409 -- a member could otherwise
     * delete their own group profile, permitted as "leave group", and
     * recreate it with an escalated role).
     * Who may is the function's to decide (T126): someone spending a founder
     * link, or someone who has started a group and fewer than three.
     * @param input The group's name and description, the founder's name in it,
     *   and the founder link to spend, if any
     * @returns The ID of the newly created group
     */
    public async createGroup(input: CreateGroupInput): Promise<string> {
      const userId = this.getCurrentUser()?.uid;
      if (!userId) {
        throw new Error('Not authenticated');
      }

      try {
        // Call the Cloud Function instead of attempting to modify data directly.
        // `this.functions`, not a bare getFunctions(): that resolves the
        // default `us-central1` region, where nothing in this project is
        // deployed, and bypasses the emulator in development.
        const createGroupFn = httpsCallable(this.functions, 'createGroup');

        const result = await createGroupFn(input);
        const { groupId } = result.data as { success: boolean; groupId: string };

        // Set the active group context
        this.setActiveGroup(groupId);

        return groupId;
      } catch (err) {
        console.error('Error creating group:', err);
        throw err;
      }
    }
  
    /**
     * Get all groups the current user is a member of.
     *
     * A user is a member of a group exactly when their group profile,
     * `groups/{g}/users/{uid}`, exists (T136). The profiles are found by the
     * `userId` each carries, across groups, which needs the `users.userId`
     * collection-group index in production; the rules let a user list only
     * their own.
     *
     * The group documents are then fetched concurrently: they are independent,
     * and fetching them one at a time cost a full network round trip per group
     * on every sign-in and reload (PERF-02).
     *
     * @returns Array of group objects with IDs, in the order they were joined
     */
    public async getGroups(): Promise<Group[]> {
      const userId = this.getCurrentUser()?.uid;
      if (!userId) return [];

      const profiles = await getDocs(
        query(collectionGroup(this.db, 'users'), where('userId', '==', userId))
      );
      const ids = profiles.docs
        .map(profile => ({ groupId: profile.ref.parent.parent?.id, joined: joinedAt(profile.data().joinedAt) }))
        .filter((entry): entry is { groupId: string; joined: number } => Boolean(entry.groupId))
        .sort((a, b) => (a.joined - b.joined) || 0)
        .map(entry => entry.groupId);

      // Fetch each group's metadata
      const groupDocs = await Promise.all(
        ids.map(groupId => getDoc(doc(this.db, 'groups', groupId)))
      );

      const groups: Group[] = [];
      groupDocs.forEach((groupDoc, index) => {
        if (groupDoc.exists()) {
          groups.push({
            id: ids[index],
            ...groupDoc.data()
          } as Group);
        }
      });

      return groups;
    }
  
    /**
     * Follow the profiles of a group's members (T132): who they are called
     * and which characters they play, for crediting what they wrote under the
     * names they have now. Each profile's `id` is its document id -- the uid
     * -- and goes last, so a stored field can never stand in for it (SEC-002).
     *
     * @param groupId The group
     * @param onNext Receives every member's profile, on every change
     * @param onError Receives a listener failure; the listener is closed after it
     * @returns Function that closes the listener
     */
    public subscribeToGroupProfiles(
      groupId: string,
      onNext: (profiles: Array<Record<string, any> & { id: string }>) => void,
      onError: (error: Error) => void
    ): Unsubscribe {
      return onSnapshot(
        collection(this.db, 'groups', groupId, 'users'),
        (snapshot) => onNext(snapshot.docs.map((profile) => ({ ...profile.data(), id: profile.id }))),
        onError
      );
    }

    /**
     * Get all users in a specific group (admin only)
     * @param groupId ID of the group to get users for
     * @returns Array of group user profile objects
     */
    public async getGroupUsers(groupId: string): Promise<any[]> {
      const userId = this.getCurrentUser()?.uid;
      if (!userId) {
        throw new Error('Not authenticated');
      }
      
      // Check if user is admin of this group or a member
      const userProfileDoc = await getDoc(doc(this.db, 'groups', groupId, 'users', userId));
      if (!userProfileDoc.exists()) {
        throw new Error('You are not a member of this group');
      }
      
      // Get users from the group's collection
      const usersCollection = collection(this.db, 'groups', groupId, 'users');
      const snapshot = await getDocs(usersCollection);
      
      return snapshot.docs.map(doc => {
        const data = doc.data();
        
        // The document id is the uid, so it goes last: a stored `id` or
        // `userId` is client-written, and one naming another member steered
        // an admin's removal onto them (SEC-002, T080).
        return {
          ...data,
          id: doc.id,
          userId: doc.id,
          joinedAt: data.joinedAt?.toDate ? data.joinedAt.toDate() : data.joinedAt
        };
      });
    }
  
    /**
     * Rename a group, or change its description (admin only).
     *
     * A plain client write, not a Cloud Function: the production rules already
     * let a group admin update the group document
     * (`firestore.rules.prod`, `allow update: if isGroupAdmin(groupId)`).
     * Those rules do not restrict *which* fields change, so
     * restricting the payload to `name` and `description` is this method's own
     * discipline -- an edit here can never touch `createdBy` or `createdAt`.
     *
     * The admin check is the same courtesy every admin method on these services
     * makes; the rules are the real gate.
     *
     * @param groupId ID of the group
     * @param updates The new name, which may not be blank, and description,
     *   which may be empty to clear it
     */
    public async updateGroup(
      groupId: string,
      updates: { name: string; description?: string }
    ): Promise<void> {
      const userId = this.getCurrentUser()?.uid;
      if (!userId) {
        throw new Error('Not authenticated');
      }

      const name = updates.name.trim();
      if (!name) {
        throw new Error('A group needs a name');
      }
      const description = (updates.description ?? '').trim();
      // The rules cap both (T119); refused here first, saying which.
      assertTextFits(NAMED_DOCUMENT_TEXT_LIMITS, { name, description });

      const isAdmin = await this.userService.isUserAdmin(groupId, userId);
      if (!isAdmin) {
        throw new Error('Only group admins can edit the group');
      }

      await updateDoc(doc(this.db, 'groups', groupId), { name, description });
    }

    /**
     * Set or clear the group's crest (admin only, T021).
     *
     * Same shape as updateGroup: a client write the rules already allow a
     * group admin, restricted here to the one field. The image itself is
     * uploaded (and the old one deleted) by the caller; this only records it.
     *
     * @param groupId ID of the group
     * @param crest The uploaded image, or null to clear it -- Firestore cannot
     *   store undefined
     */
    public async setGroupCrest(groupId: string, crest: StoredImage | null): Promise<void> {
      const userId = this.getCurrentUser()?.uid;
      if (!userId) {
        throw new Error('Not authenticated');
      }

      const isAdmin = await this.userService.isUserAdmin(groupId, userId);
      if (!isAdmin) {
        throw new Error('Only group admins can change the crest');
      }

      await updateDoc(doc(this.db, 'groups', groupId), { crest });
    }

    /**
     * Remove a user from a specific group (admin only)
     * @param groupId ID of the group
     * @param userId ID of the user to remove
     */
    public async removeUserFromGroup(groupId: string, userId: string): Promise<void> {
      const currentUserId = this.getCurrentUser()?.uid;
      if (!currentUserId) {
        throw new Error('Not authenticated');
      }
      
      try {
        // Call the Cloud Function instead of attempting to modify data directly.
        // Uses `this.functions` -- the instance BaseFirebaseService bound to
        // `europe-west1`, where this function is deployed, and to the emulator
        // in development -- rather than a bare getFunctions(), which resolves
        // the default `us-central1` region and reaches nothing.
        const removeUserFn = httpsCallable(this.functions, 'removeUserFromGroup');

        await removeUserFn({ groupId, userId });
      } catch (err) {
        console.error('Error removing user from group:', err);
        throw err;
      }
    }
  
    /**
     * Delete a group and everything stored for it, for every member (admin
     * only, T037).
     *
     * Runs in the `deleteGroup` Cloud Function: a client cannot enumerate
     * the subcollections beneath a group, and the rules refuse a client
     * deleting the group document. Members keep their accounts; the group is
     * taken off each of them.
     *
     * @param groupId ID of the group
     */
    public async deleteGroup(groupId: string): Promise<void> {
      if (!this.getCurrentUser()) {
        throw new Error('Not authenticated');
      }

      const deleteGroupFn = httpsCallable(this.functions, 'deleteGroup');
      await deleteGroupFn({ groupId });
    }

    /**
     * Make a member an admin, or an admin a member (admin only, T034).
     *
     * Runs in the `setMemberRole` Cloud Function. The rules refuse any client
     * write to `role`, because the one check that matters here -- that the
     * change does not leave the group with no admin at all (T035) -- needs
     * every member's role, and a rule cannot count.
     *
     * @param groupId ID of the group
     * @param userId The member whose role changes
     * @param role The role they should have
     */
    public async setMemberRole(
      groupId: string,
      userId: string,
      role: 'admin' | 'member'
    ): Promise<void> {
      if (!this.getCurrentUser()) {
        throw new Error('Not authenticated');
      }

      const setMemberRoleFn = httpsCallable(this.functions, 'setMemberRole');
      await setMemberRoleFn({ groupId, userId, role });
    }
  }
  
  export default GroupService;