// src/context/firebase/FirebaseContext.tsx
import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { User, onAuthStateChanged } from 'firebase/auth';
import firebaseServices from 'core/services/firebase';
import { UserProfile, GroupUserProfile, Group, Campaign } from 'core/types/user';

// Define a custom event for auth state changes
export const AUTH_STATE_CHANGED_EVENT = 'auth-state-changed';

// Core context type with shared state
interface FirebaseContextType {
  // Auth state
  user: User | null;
  userProfile: UserProfile | null;
  loading: boolean;
  error: string | null;
  setError: (error: string | null) => void;
  
  // Group context
  groups: Group[];
  activeGroupId: string | null;
  activeGroupUserProfile: GroupUserProfile | null;
  
  // Campaign context
  campaigns: Campaign[];
  activeCampaignId: string | null;
  
  // Context updaters
  refreshGroups: () => Promise<Group[]>;
  refreshCampaigns: () => Promise<Campaign[]>;
  refreshUserProfile: () => Promise<void>;
  /**
   * Apply a write this client just made to the signed-in user's account
   * profile, without reading it back (T032, `PERF-13`).
   */
  applyUserProfileChanges: (changes: Partial<UserProfile>) => void;
  /**
   * Apply a write this client just made to the signed-in user's profile in
   * the active group, without reading it back (T032, `PERF-13`).
   */
  applyGroupUserProfileChanges: (changes: Partial<GroupUserProfile>) => void;
  reloadUserContext: () => Promise<void>;
  switchGroup: (groupId: string) => Promise<void>;
  switchCampaign: (campaignId: string) => Promise<void>;
}

const FirebaseContext = createContext<FirebaseContextType | undefined>(undefined);

/**
 * Thrown inside a load that the auth state has overtaken (AUTH-003), so the
 * chain stops without touching state that now belongs to a newer user.
 */
class StaleAuthError extends Error {
  constructor() {
    super('Auth state changed while loading');
    this.name = 'StaleAuthError';
  }
}

export const FirebaseProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // State
  const [user, setUser] = useState<User | null>(null);
  /**
   * The uid of the newest auth state, or null when signed out. Set as each
   * auth callback starts, so a load begun for an earlier user can tell it has
   * been overtaken: every load below checks it after each await and drops its
   * result. Without this, a slow profile load finishing after sign-out (or
   * after another user signed in) wrote the old profile, group and campaign
   * back (AUTH-003).
   */
  const authUidRef = useRef<string | null>(null);
  /** Whether a result loaded for `uid` arrived after the auth state moved on. */
  const isStale = (uid: string) => authUidRef.current !== uid;
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [profileLoading, setProfileLoading] = useState(false);
  const [groupsLoading, setGroupsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loading = authLoading || profileLoading || groupsLoading;
  
  // Group and campaign state
  const [groups, setGroups] = useState<Group[]>([]);
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null);
  const [activeGroupUserProfile, setActiveGroupUserProfile] = useState<GroupUserProfile | null>(null);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [activeCampaignId, setActiveCampaignId] = useState<string | null>(null);

  // Dispatch auth state change event
  const dispatchAuthStateChangedEvent = (authenticated: boolean) => {
    const event = new CustomEvent(AUTH_STATE_CHANGED_EVENT, { 
      detail: { authenticated } 
    });
    window.dispatchEvent(event);
  };

  // Load user profile
  const refreshUserProfile = async () => {
    if (!user) return;
    
    try {
      const profile = await firebaseServices.user.getUserProfile(user.uid);
      setUserProfile(profile);

      if (profile?.activeGroupId) {
        await setActiveGroupContext(profile.activeGroupId, user);
      } else {
        console.warn(`FirebaseContext: No active group ID found in user profile`);
      }
    } catch (err) {
      console.error('Error fetching user profile:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch user profile');
    }
  };

  /*
    A profile edit used to end in `refreshUserProfile()`, which re-reads the
    account, the group profile and the campaign list -- about four requests
    to learn back what was just written, and the edit waited for all of them
    (PERF-13). The write's own fields are applied to state instead.
  */
  const applyUserProfileChanges = useCallback((changes: Partial<UserProfile>) => {
    setUserProfile(previous => (previous ? { ...previous, ...changes } : previous));
  }, []);

  const applyGroupUserProfileChanges = useCallback((changes: Partial<GroupUserProfile>) => {
    setActiveGroupUserProfile(previous => (previous ? { ...previous, ...changes } : previous));
  }, []);

  // Set active group and load related data
  const setActiveGroupContext = async (groupId: string, currentUser: User | null = null) => {
    try {
      // Set the group context in Firebase service
      firebaseServices.auth.setActiveGroup(groupId);
      setActiveGroupId(groupId);
      
      // Use provided currentUser parameter if available, otherwise fall back to state
      const authUser = currentUser || user;
      
      if (!authUser) {
        console.warn('Cannot load group profile - no authenticated user');
        return;
      }
      
      // Ask for the group's campaigns at the same time as the user's profile
      // in it, rather than after: the two requests are independent, and
      // waiting cost a network round trip on every sign-in and reload
      // (PERF-02). The campaigns are only used once the profile confirms
      // membership, so a failure is swallowed here and handled below.
      const campaignsPromise = Promise.resolve().then(() =>
        firebaseServices.campaign.getCampaigns(groupId)
      );
      campaignsPromise.catch(() => undefined);

      // Load user's profile in this group
      const groupProfile = await firebaseServices.user.getGroupUserProfile(groupId, authUser.uid);
      if (isStale(authUser.uid)) return;

      if (groupProfile) {
        setActiveGroupUserProfile(groupProfile);
        
        // Now load campaigns
        try {
          const groupCampaigns = await campaignsPromise;
          if (isStale(authUser.uid)) return;
          setCampaigns(groupCampaigns);
          
          if (groupCampaigns.length > 0) {
            // Determine which campaign should be active
            // Only use the activeCampaignId if it's actually a campaign ID
            let campaignIdToSet = '';
            
            if (groupProfile.activeCampaignId) {
              // Check if this ID corresponds to a campaign
              const campaignExists = groupCampaigns.some(c => c.id === groupProfile.activeCampaignId);
              
              if (campaignExists) {
                campaignIdToSet = groupProfile.activeCampaignId;
              } else {
                // If activeCampaignId doesn't point to a real campaign, use first available
                campaignIdToSet = groupCampaigns[0].id;
              }
            } else {
              // No activeCampaignId set yet, use first campaign
              campaignIdToSet = groupCampaigns[0].id;
            }
            
            // Set the active campaign
            firebaseServices.auth.setActiveCampaign(campaignIdToSet);
            setActiveCampaignId(campaignIdToSet);
          }
        } catch (err) {
          console.error(`Error loading campaigns for group ${groupId}:`, err);
        }
      } else {
        console.warn(`No group profile found for user ${authUser.uid} in group ${groupId}`);
      }
    } catch (err) {
      console.error('Error setting active group context:', err);
      setError(err instanceof Error ? err.message : 'Failed to set active group');
    }
  };

  // Refresh groups list
  const refreshGroups = async () => {
    if (!user) return [];
    
    try {
      const userGroups = await firebaseServices.group.getGroups();
      setGroups(userGroups);

      // If user has exactly one group and no active group is set, auto-select it
      if (userGroups.length === 1 && !activeGroupId) {
        await setActiveGroupContext(userGroups[0].id, user);
      }
      
      return userGroups;
    } catch (err) {
      console.error('Error loading groups:', err);
      return [];
    }
  };

  // Refresh campaigns list
  const refreshCampaigns = async () => {
    if (!activeGroupId) return [];
    
    try {
      const groupCampaigns = await firebaseServices.campaign.getCampaigns(activeGroupId);
      setCampaigns(groupCampaigns);
      
      // Auto-select first campaign if available and none is selected
      if (groupCampaigns.length > 0 && !activeCampaignId) {
        const campaignToActivate = groupCampaigns[0].id;
        firebaseServices.auth.setActiveCampaign(campaignToActivate);
        setActiveCampaignId(campaignToActivate);
      }
      
      return groupCampaigns;
    } catch (err) {
      console.error('Error loading campaigns:', err);
      return [];
    }
  };

  /**
   * Switch the active group, in Firestore AND in React state.
   *
   * `refreshGroups` only re-lists the user's groups; it calls
   * `setActiveGroupContext` solely for the one-group-no-active-group case. So
   * persisting `activeGroupId` and calling it -- which is what
   * `useGroups().setActiveGroup` used to do -- left `activeGroupId` in this
   * provider pointing at the OLD group, and only a full page reload made the
   * switch visible. `setActiveGroupContext` already does the whole job
   * correctly, including loading the new group's campaigns and activating the
   * one the user last had open there; it was simply unreachable from outside.
   *
   * Firestore is written first so a rejected write leaves the context on the
   * group it was already showing.
   */
  const switchGroup = async (groupId: string): Promise<void> => {
    const userId = firebaseServices.auth.getCurrentUserId();
    if (!userId) {
      throw new Error('Not authenticated');
    }

    await firebaseServices.user.updateUserProfile(userId, { activeGroupId: groupId });
    await setActiveGroupContext(groupId);
  };

  /**
   * Switch the active campaign within the active group, in Firestore AND in
   * React state.
   *
   * `refreshCampaigns` only assigns `activeCampaignId` when there is none, so
   * the previous implementation in `useCampaigns` moved the SERVICE-level
   * campaign and the stored preference while this provider kept serving the
   * old id to every consumer.
   *
   * The service context and the React state are both set only after the write
   * resolves, so a failure cannot leave the three out of step.
   */
  const switchCampaign = async (campaignId: string): Promise<void> => {
    if (!activeGroupId) {
      throw new Error('No active group selected');
    }

    const userId = firebaseServices.auth.getCurrentUserId();
    if (userId) {
      await firebaseServices.user.updateGroupUserProfile(activeGroupId, userId, {
        activeCampaignId: campaignId
      });
    }

    firebaseServices.auth.setActiveCampaign(campaignId);
    setActiveCampaignId(campaignId);
  };

  // Load user profile with retry logic
  const loadUserProfile = async (userId: string) => {
    let retryCount = 0;
    const maxRetries = 3;

    while (retryCount < maxRetries) {
      try {
        const profile = await firebaseServices.user.getUserProfile(userId);
        if (isStale(userId)) throw new StaleAuthError();

        if (profile) {
          setUserProfile(profile);
          return profile;
        } else {
          console.warn(`No profile found for user ${userId}`);
          retryCount++;
          // Wait before retry -- but not after the last attempt, where the
          // wait only delayed the error by a second (PERF-02).
          if (retryCount < maxRetries) {
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
        }
      } catch (err) {
        if (err instanceof StaleAuthError) throw err;
        console.error(`Error loading user profile (attempt ${retryCount + 1}):`, err);
        if (retryCount >= maxRetries - 1) throw err;
        await new Promise(resolve => setTimeout(resolve, 1000));
        retryCount++;
      }
    }
    
    throw new Error('Failed to load user profile after multiple attempts');
  };

  // Load groups with proper active group selection
  const loadGroups = async (userId: string, profile: UserProfile, currentUser: User) => {
    try {
      // The groups come from the user's group profiles, the one record of
      // membership (T136), not from the global profile.
      const userGroups = await firebaseServices.group.getGroups();
      if (isStale(userId)) throw new StaleAuthError();
      setGroups(userGroups);

      if (userGroups.length > 0) {
        // The profile's active group, while they are still in it; else the
        // first they joined.
        const targetGroupId = userGroups.some(group => group.id === profile.activeGroupId)
          ? profile.activeGroupId as string
          : userGroups[0].id;
        await setActiveGroupContext(targetGroupId, currentUser);
      } else {
        console.warn(`No groups found for user ${userId}`);
      }
      
      return userGroups;
    } catch (err) {
      if (!(err instanceof StaleAuthError)) console.error('Error loading groups:', err);
      throw err;
    }
  };

  /**
   * Load the signed-in user's profile and groups again, from scratch.
   *
   * For the moment just after a brand-new account joins its first group. The
   * auth listener below ran when the account was created, before
   * `redeemInvitation` had written a profile, so it found none -- and it is
   * not going to run again, because nobody signs in twice. Every other
   * refresher here reads `user` from a closure that, in the handler that just
   * signed in, still holds `null`; this reads the signed-in user from the auth
   * service instead.
   */
  const reloadUserContext = async (): Promise<void> => {
    const currentUser = firebaseServices.auth.getUser();
    if (!currentUser) return;
    // The auth service is never behind the listener -- it changes first, and
    // the listener hears about it after -- so it is the newest auth state
    // there is. This runs just after a sign-in the listener may not have
    // delivered yet.
    authUidRef.current = currentUser.uid;

    try {
      const profile = await firebaseServices.user.getUserProfile(currentUser.uid);
      if (!profile || isStale(currentUser.uid)) return;
      setError(null);
      setUserProfile(profile);
      await loadGroups(currentUser.uid, profile, currentUser);
    } catch (err) {
      if (err instanceof StaleAuthError) return;
      console.error('Error reloading user context:', err);
      setError(err instanceof Error ? err.message : 'Failed to load user data');
    }
  };

  // Listen to authentication state
  useEffect(() => {
    const auth = firebaseServices.auth.getAuth();
    
    const unsubscribe = onAuthStateChanged(auth, 
      async (firebaseUser) => {
        authUidRef.current = firebaseUser?.uid ?? null;
        setUser(firebaseUser);
        
        if (firebaseUser) {
          dispatchAuthStateChangedEvent(true);
          
          // Clear previous data to avoid mixing old and new data
          setUserProfile(null);
          setActiveGroupUserProfile(null);
          setGroups([]);
          setCampaigns([]);
          
          try {
            // Step 1: Load user profile
            setProfileLoading(true);
            const profile = await loadUserProfile(firebaseUser.uid);
            setProfileLoading(false);
            
            // Step 2: Load groups - using the profile returned from loadUserProfile
            // loadUserProfile above either resolves with a truthy profile or throws,
            // so `profile` is always truthy here.
            setGroupsLoading(true);
            // Pass the firebaseUser directly to loadGroups
            await loadGroups(firebaseUser.uid, profile, firebaseUser);
            setGroupsLoading(false);
            setAuthLoading(false);
          } catch (err) {
            // Overtaken by a newer auth state, which owns the state and the
            // loading flags from here on.
            if (err instanceof StaleAuthError) return;
            console.error('Error in auth state change loading:', err);
            setError(err instanceof Error ? err.message : 'Failed to load user data');
            // All three flags must be cleared here, not just the last two.
            // `loadUserProfile` throws when its retries are exhausted, which
            // skips the `setProfileLoading(false)` on the happy path above and
            // would otherwise leave `profileLoading` true forever. Since
            // `loading` is `authLoading || profileLoading || groupsLoading`,
            // one stuck flag pins the whole thing true — and `useAuth().loading`
            // now feeds `useCampaignContextStatus().isResolving` (bug #1413),
            // so every entity page would show a permanent spinner instead of
            // its error state, and `hasRequiredContext` would never become true.
            setProfileLoading(false);
            setGroupsLoading(false);
            setAuthLoading(false);
          }
        } else {
          dispatchAuthStateChangedEvent(false);
          
          // Clear all state on logout
          setUserProfile(null);
          setActiveGroupUserProfile(null);
          setActiveGroupId(null);
          setActiveCampaignId(null);
          setGroups([]);
          setCampaigns([]);
          setAuthLoading(false);
        }
      }
    );

    return () => unsubscribe();
    // Subscribes once, on mount, on purpose. `loadGroups` is a new function
    // every render; listing it would tear down and re-register the auth
    // listener on each one. It reads only its arguments, state setters and
    // services, so the first render's copy behaves the same as any later one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Context value
  const value: FirebaseContextType = {
    // Auth state
    user,
    userProfile,
    loading,
    error,
    setError,
    
    // Group context
    groups,
    activeGroupId,
    activeGroupUserProfile,
    
    // Campaign context
    campaigns,
    activeCampaignId,
    
    // Context updaters
    refreshGroups,
    refreshCampaigns,
    refreshUserProfile,
    applyUserProfileChanges,
    applyGroupUserProfileChanges,
    reloadUserContext,
    switchGroup,
    switchCampaign
  };

  return (
    <FirebaseContext.Provider value={value}>
      {children}
    </FirebaseContext.Provider>
  );
};

// Base hook for accessing FirebaseContext
export const useFirebaseContext = () => {
  const context = useContext(FirebaseContext);
  if (context === undefined) {
    throw new Error('useFirebaseContext must be used within a FirebaseProvider');
  }
  return context;
};