// src/core/services/firebase/group/InvitationService.ts
import { 
    collection, 
    doc, 
    getDoc, 
    getDocs,
    updateDoc,
    deleteDoc
  } from 'firebase/firestore';
  import { httpsCallable } from 'firebase/functions';
  import BaseFirebaseService from '../core/BaseFirebaseService';
  import ServiceRegistry from '../core/ServiceRegistry';
  import type UserService from '../user/UserService';
  import {
    HASHED_INVITATION_SCHEME,
    hashInvitationToken,
    isRegistrationTokenRedeemable
  } from '../../../utils/registration-token';

  /**
   * InvitationService manages registration tokens and group invitations
   */
  class InvitationService extends BaseFirebaseService {
    private static instance: InvitationService;
    private userService: UserService;
  
    private constructor() {
      super();
      this.userService = ServiceRegistry.getInstance().get('userService');
    }
  
    /**
     * Get singleton instance of InvitationService
     */
    public static getInstance(): InvitationService {
      if (!InvitationService.instance) {
        InvitationService.instance = new InvitationService();
      }
      return InvitationService.instance;
    }
  
    /**
     * Make an invitation into a group (admin only), and return its token.
     *
     * Runs in the `createInvitation` Cloud Function (T145), which checks the
     * caller is an admin, stores the invitation under the token's hash and
     * seals the token beside it. The browser used to mint and store tokens
     * itself, each under its own value, so the collection held every unspent
     * link in the clear.
     *
     * @param groupId ID of the group to invite into
     * @param notes Optional note on who the invitation is for
     * @returns The token, for the link
     */
    public async generateGroupRegistrationToken(groupId: string, notes: string = ''): Promise<string> {
      const create = httpsCallable<{ groupId: string; notes: string }, { token: string }>(
        this.functions,
        'createInvitation'
      );
      const { data } = await create({ groupId, notes });
      return data.token;
    }

    /**
     * The token of one of a group's open invitations, to copy its link again
     * (admin only). Its id is its token's hash, so only `revealInvitation`,
     * which holds the key to the sealed copy, can say what it is.
     *
     * @param groupId ID of the group
     * @param invitationId The invitation's document id
     * @returns The token, for the link
     */
    public async revealGroupRegistrationToken(groupId: string, invitationId: string): Promise<string> {
      const reveal = httpsCallable<{ groupId: string; invitationId: string }, { token: string }>(
        this.functions,
        'revealInvitation'
      );
      const { data } = await reveal({ groupId, invitationId });
      return data.token;
    }

  /**
   * Validate a registration token and get its associated group ID
   *
   * The invitation is stored under the token's hash (T145), or, if it was
   * made before that, under the token itself and with no `scheme`. Only an
   * invitation of the first kind is found by its hash, and only one of the
   * second by its token: a hash presented as a token finds nothing.
   *
   * @param token The token to validate
   * @returns Object with validation result and group ID
   */
  public async validateRegistrationToken(token: string): Promise<{isValid: boolean, groupId?: string}> {
    try {
      // Extract group ID from URL parameters
      const urlParams = new URLSearchParams(window.location.search);
      const groupId = urlParams.get('groupId');

      // If no groupId provided, token cannot be validated
      if (!groupId) {
        return { isValid: false };
      }

      const hash = await hashInvitationToken(token);
      if (hash === null) {
        // No Web Crypto here, so no way to find the invitation. This is only a
        // courtesy check before the call; the server's is the one that counts.
        return { isValid: true, groupId };
      }
      const [hashed, legacy] = await Promise.all([
        getDoc(doc(this.db, 'groups', groupId, 'registrationTokens', hash)),
        getDoc(doc(this.db, 'groups', groupId, 'registrationTokens', token)),
      ]);
      const invitation =
        hashed.exists() && hashed.data()?.scheme === HASHED_INVITATION_SCHEME ? hashed :
          legacy.exists() && legacy.data()?.scheme === undefined ? legacy :
            null;

      // Check the token exists, hasn't been used, and hasn't expired
      if (invitation && isRegistrationTokenRedeemable(invitation.data() ?? {})) {
        return { isValid: true, groupId };
      }

      return { isValid: false };
    } catch (error) {
      return { isValid: false };
    }
  }
  
    /**
     * Get registration tokens for a specific group (admin only)
     * @param groupId ID of the group to get tokens for
     * @returns Array of registration token objects
     */
    public async getGroupRegistrationTokens(groupId: string): Promise<any[]> {
      const userId = this.getCurrentUser()?.uid;
      if (!userId) {
        throw new Error('Not authenticated');
      }
      
      // Check if user is admin of this group
      const isAdmin = await this.userService.isUserAdmin(groupId, userId);
      if (!isAdmin) {
        throw new Error('Only group admins can view registration tokens');
      }
      
      // Get tokens from the group's collection
      const tokensCollection = collection(this.db, 'groups', groupId, 'registrationTokens');
      const snapshot = await getDocs(tokensCollection);
      
      return snapshot.docs.map(doc => {
        // Neither the `token` an invitation made before T145 stores, nor the
        // sealed copy one made since carries: a link is built only from what
        // `revealGroupRegistrationToken` returns.
        const { token: _token, sealed: _sealed, ...data } = doc.data();

        return {
          ...data,
          // After the spread, not before it: the document id is the
          // invitation's identity, whatever a stored field says.
          id: doc.id,
          createdAt: data.createdAt?.toDate ? data.createdAt.toDate() : data.createdAt,
          expiresAt: data.expiresAt?.toDate ? data.expiresAt.toDate() : data.expiresAt,
          usedAt: data.usedAt?.toDate ? data.usedAt.toDate() : data.usedAt
        };
      });
    }
  
    /**
     * Delete a registration token from a specific group (admin only)
     * @param groupId ID of the group
     * @param invitationId The invitation's document id
     */
    public async deleteGroupRegistrationToken(groupId: string, invitationId: string): Promise<void> {
      const userId = this.getCurrentUser()?.uid;
      if (!userId) {
        throw new Error('Not authenticated');
      }
      
      // Check if user is admin of this group
      const isAdmin = await this.userService.isUserAdmin(groupId, userId);
      if (!isAdmin) {
        throw new Error('Only group admins can delete registration tokens');
      }
      
      await deleteDoc(doc(this.db, 'groups', groupId, 'registrationTokens', invitationId));
    }

    /**
     * Set the note on a registration token (admin only).
     *
     * The note is who the invitation is *for*, and it is the only thing that
     * tells one pending invitation from another in the admin view -- the token
     * string is never shown. Creating an invitation deliberately asks for
     * nothing, so this is where a note gets attached: afterwards, on the row.
     *
     * Only `notes` is written. The rules already permit a group admin to update
     * a token (`allow update: if isGroupAdmin(groupId)`), so this needs no rules
     * change; restricting the payload to one field is this method's own
     * discipline, so that an admin edit can never touch `used`, `usedAt` or
     * `usedBy` and resurrect a spent invitation.
     *
     * @param groupId ID of the group
     * @param invitationId The invitation's document id
     * @param notes The new note, which may be empty to clear it
     */
    public async updateGroupRegistrationTokenNotes(
      groupId: string,
      invitationId: string,
      notes: string
    ): Promise<void> {
      const userId = this.getCurrentUser()?.uid;
      if (!userId) {
        throw new Error('Not authenticated');
      }

      // Check if user is admin of this group
      const isAdmin = await this.userService.isUserAdmin(groupId, userId);
      if (!isAdmin) {
        throw new Error('Only group admins can update registration tokens');
      }

      await updateDoc(
        doc(this.db, 'groups', groupId, 'registrationTokens', invitationId),
        { notes }
      );
    }

    /**
     * Spend an invitation token on the signed-in user's membership.
     *
     * Runs in the `redeemInvitation` Cloud Function (T052), never as client
     * writes: membership is the group profile `groups/{g}/users/{uid}` (T136),
     * which the Firestore rules trust, so a client allowed to write it could
     * join any group whose id it knew, token or not. The function checks the token -- exists, unused,
     * unexpired -- and writes the membership, the group profile, the username
     * reservation and the spent token in one transaction.
     *
     * Uses `this.functions`, the instance bound to `europe-west1` and to the
     * emulator in development, not a bare `getFunctions()`.
     */
    private async redeemInvitation(groupId: string, token: string, username: string): Promise<void> {
      const redeem = httpsCallable(this.functions, 'redeemInvitation');
      await redeem({ groupId, token, username });
      this.setActiveGroup(groupId);
    }

    /**
     * Join an existing account to a new group using an invitation token
     * @param token Registration token for the group
     * @param username Username to use in the new group
     */
    public async joinGroupWithToken(token: string, username: string): Promise<void> {
      const user = this.getCurrentUser();
      if (!user) {
        throw new Error('You must be signed in to join a group');
      }
      
      // Checked here as well as on the server so a spent link fails with a
      // clear message before anything is sent. The server's check is the one
      // that counts.
      const { isValid, groupId } = await this.validateRegistrationToken(token);
      
      if (!isValid || !groupId) {
        throw new Error('Invalid or expired invitation token');
      }
      
      await this.redeemInvitation(groupId, token, username);
    }
  
    /**
     * Let `email` create an account from this invitation.
     *
     * Accounts are invite-only: the `gateAccountCreation` blocking function
     * refuses to create one for an address nobody reserved. This is the
     * reservation -- the `reserveSignUp` function checks the invitation and
     * records the address -- and it has to happen before the magic link is
     * sent or the Google popup opens. It spends nothing; `redeemInvitation`
     * does that once the account exists.
     *
     * @param token Registration token for the group
     * @param email The address the new account will have
     */
    public async reserveSignUp(token: string, email: string): Promise<void> {
      const { isValid, groupId } = await this.validateRegistrationToken(token);
      if (!isValid || !groupId) {
        throw new Error('Invalid or expired invitation token');
      }

      const reserve = httpsCallable(this.functions, 'reserveSignUp');
      await reserve({ groupId, token, email });
    }

    /**
     * Reserve an account for `email` on the strength of a founder link (T127).
     *
     * The founder-link twin of {@link reserveSignUp}. There is nothing to check
     * here first: founder invitations are server-only, so `reserveSignUp`
     * checks the link itself and says what is wrong with it. It spends
     * nothing; `createGroup` spends the link.
     *
     * @param founderToken The token from `/join?founder=…`
     * @param email The address the new account will have
     */
    public async reserveFounderSignUp(founderToken: string, email: string): Promise<void> {
      const reserve = httpsCallable(this.functions, 'reserveSignUp');
      await reserve({ founderToken, email });
    }
  }

  export default InvitationService;
