// src/context/firebase/hooks/useInvitations.ts
import { useCallback } from 'react';
import { useFirebaseContext } from 'features/user-management/auth/context/FirebaseContext';
import firebaseServices from 'core/services/firebase';

export function useInvitations() {
  const { 
    activeGroupId, 
    activeGroupUserProfile,
    setError, 
    refreshGroups 
  } = useFirebaseContext();

  // Generate registration token
  const generateRegistrationToken = useCallback(async (
    notes: string = ''
  ): Promise<string> => {
    try {
      setError(null);
      
      if (!activeGroupId) {
        throw new Error('No active group selected');
      }
      
      // Check if current user is admin (case-insensitive, matching useGroups.isAdmin)
      if (!activeGroupUserProfile || activeGroupUserProfile.role?.toLowerCase() !== 'admin') {
        throw new Error('Only admins can generate registration tokens');
      }
      
      return await firebaseServices.invitation.generateGroupRegistrationToken(activeGroupId, notes);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate registration token');
      throw err;
    }
  }, [activeGroupId, activeGroupUserProfile, setError]);

  // Validate token
  const validateToken = useCallback(async (
    token: string
  ): Promise<boolean> => {
    try {
      setError(null);
      const result = await firebaseServices.invitation.validateRegistrationToken(token);
      return result.isValid;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred validating the invitation');
      return false;
    }
  }, [setError]);

  // Reserve an account for `email` against the invitation, before signing in
  const reserveSignUp = useCallback(async (
    token: string,
    email: string
  ): Promise<void> => {
    try {
      setError(null);
      await firebaseServices.invitation.reserveSignUp(token, email);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not prepare your sign-up');
      throw err;
    }
  }, [setError]);

  // Reserve an account for `email` against a founder link (T127)
  const reserveFounderSignUp = useCallback(async (
    founderToken: string,
    email: string
  ): Promise<void> => {
    try {
      setError(null);
      await firebaseServices.invitation.reserveFounderSignUp(founderToken, email);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not prepare your sign-up');
      throw err;
    }
  }, [setError]);

  // Join group with token
  const joinGroupWithToken = useCallback(async (
    token: string, 
    username: string
  ): Promise<void> => {
    try {
      setError(null);
      await firebaseServices.invitation.joinGroupWithToken(token, username);
      
      // Refresh groups
      await refreshGroups();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to join group');
      throw err;
    }
  }, [setError, refreshGroups]);

  // Get registration tokens
  const getRegistrationTokens = useCallback(async () => {
    try {
      setError(null);
      
      if (!activeGroupId) {
        throw new Error('No active group selected');
      }
      
      return await firebaseServices.invitation.getGroupRegistrationTokens(activeGroupId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to get registration tokens');
      throw err;
    }
  }, [activeGroupId, setError]);

  // The token of an open invitation, to copy its link again (T145)
  const revealRegistrationToken = useCallback(async (
    invitationId: string
  ): Promise<string> => {
    try {
      setError(null);

      if (!activeGroupId) {
        throw new Error('No active group selected');
      }

      return await firebaseServices.invitation.revealGroupRegistrationToken(activeGroupId, invitationId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to copy the invitation');
      throw err;
    }
  }, [activeGroupId, setError]);

  // Delete registration token
  const deleteRegistrationToken = useCallback(async (
    invitationId: string
  ): Promise<void> => {
    try {
      setError(null);
      
      if (!activeGroupId) {
        throw new Error('No active group selected');
      }
      
      await firebaseServices.invitation.deleteGroupRegistrationToken(activeGroupId, invitationId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete registration token');
      throw err;
    }
  }, [activeGroupId, setError]);

  // Set the note on an existing token
  const updateRegistrationTokenNotes = useCallback(async (
    invitationId: string,
    notes: string
  ): Promise<void> => {
    try {
      setError(null);

      if (!activeGroupId) {
        throw new Error('No active group selected');
      }

      await firebaseServices.invitation.updateGroupRegistrationTokenNotes(
        activeGroupId,
        invitationId,
        notes
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update the invitation note');
      throw err;
    }
  }, [activeGroupId, setError]);

  return {
    generateRegistrationToken,
    validateToken,
    reserveSignUp,
    reserveFounderSignUp,
    joinGroupWithToken,
    getRegistrationTokens,
    revealRegistrationToken,
    deleteRegistrationToken,
    updateRegistrationTokenNotes
  };
}