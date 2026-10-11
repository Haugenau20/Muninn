// src/core/services/firebase/campaign/CampaignService.ts
import {
    collection,
    doc,
    getDocs,
    updateDoc,
    getCountFromServer,
    serverTimestamp
  } from 'firebase/firestore';
  import { httpsCallable } from 'firebase/functions';
  import BaseFirebaseService from '../core/BaseFirebaseService';
  import ServiceRegistry from '../core/ServiceRegistry';
  import type UserService from '../user/UserService';
  import { Campaign } from '../../../types/user';
  import { assertTextFits } from '../data/TextTooLongError';
  import { NAMED_DOCUMENT_TEXT_LIMITS } from '../../../constants/textLimits';

  /**
   * How much a campaign holds. Used to tell two campaigns apart in the
   * context switcher, where a name alone is not enough.
   */
  export interface CampaignCounts {
    chapters: number;
    npcs: number;
  }

  /**
   * CampaignService manages campaign operations
   */
  class CampaignService extends BaseFirebaseService {
    private static instance: CampaignService;
    private userService: UserService;
  
    private constructor() {
      super();
      this.userService = ServiceRegistry.getInstance().get('userService');
    }
  
    /**
     * Get singleton instance of CampaignService
     */
    public static getInstance(): CampaignService {
      if (!CampaignService.instance) {
        CampaignService.instance = new CampaignService();
      }
      return CampaignService.instance;
    }
  
    /**
     * Create a new campaign within a group
     *
     * Delegates to the `createCampaign` Cloud Function (T128), which counts
     * the group's campaigns in the transaction that creates one: a group holds
     * at most five, which the rules, unable to count, could not hold. It also
     * picks the id (the name's slug, or the slug and a suffix when that is
     * taken) and makes the new campaign the creator's active one.
     * @param groupId ID of the group to create campaign in
     * @param name Name of the campaign
     * @param description Optional description of the campaign
     * @returns The ID of the newly created campaign
     */
    public async createCampaign(groupId: string, name: string, description?: string): Promise<string> {
      const userId = this.getCurrentUser()?.uid;
      if (!userId) {
        throw new Error('Not authenticated');
      }
      // The function caps both (T119); refused here first, saying which.
      assertTextFits(NAMED_DOCUMENT_TEXT_LIMITS, { name, description });

      // `this.functions`, not a bare getFunctions(): that resolves the default
      // `us-central1` region, where nothing in this project is deployed.
      const createCampaignFn = httpsCallable<
        { groupId: string; name: string; description: string },
        { success: boolean; campaignId: string }
      >(this.functions, 'createCampaign');
      const { campaignId } = (
        await createCampaignFn({ groupId, name, description: description || '' })
      ).data;

      this.setActiveCampaign(campaignId);
      return campaignId;
    }

    /**
     * Get all campaigns in a specific group
     * @param groupId ID of the group to get campaigns for
     * @returns Array of campaign objects with IDs
     */
    public async getCampaigns(groupId: string): Promise<Campaign[]> {
      const userId = this.getCurrentUser()?.uid;
      if (!userId) {
        return [];
      }
      
      // The membership check and the campaign list are requested together
      // rather than one after the other, which saves a network round trip on
      // every sign-in and reload (PERF-02). The list is only used once the
      // check has passed; for a non-member the rules refuse it, and that
      // refusal is swallowed so it cannot surface as an unhandled rejection.
      // Started inside `then` so a synchronous throw lands there too.
      const snapshotPromise = Promise.resolve().then(() =>
        getDocs(collection(this.db, 'groups', groupId, 'campaigns'))
      );
      snapshotPromise.catch(() => undefined);

      // Check if user is a member of this group
      const userProfileDoc = await this.userService.getGroupUserProfile(groupId, userId);
      if (!userProfileDoc) {
        console.warn(`CampaignService: User ${userId} is not a member of group ${groupId}`);
        return [];
      }

      try {
        // Get campaigns from the group's collection
        const snapshot = await snapshotPromise;

        const campaigns = snapshot.docs.map(doc => ({
          id: doc.id,
          groupId,
          ...doc.data()
        } as Campaign));
        
        return campaigns;
      } catch (error) {
        console.error(`CampaignService: Error fetching campaigns for group ${groupId}:`, error);
        return [];
      }
    }

    /**
     * Count the chapters and NPCs in a campaign.
     *
     * Aggregation queries bill one read each regardless of collection size,
     * which is what makes it affordable to describe every campaign in the
     * switcher rather than only the active one. The two counts run in
     * parallel; either rejecting rejects the pair, and the caller decides what
     * a missing count means -- in the switcher, a row with no second line.
     *
     * @param groupId ID of the group the campaign belongs to
     * @param campaignId ID of the campaign to describe
     * @returns Chapter and NPC counts for that campaign
     */
    public async getCampaignCounts(
      groupId: string,
      campaignId: string
    ): Promise<CampaignCounts> {
      const userId = this.getCurrentUser()?.uid;
      if (!userId) {
        throw new Error('Not authenticated');
      }

      const userProfileDoc = await this.userService.getGroupUserProfile(groupId, userId);
      if (!userProfileDoc) {
        throw new Error('You are not a member of this group');
      }

      const countOf = async (collectionName: string): Promise<number> => {
        const snapshot = await getCountFromServer(
          collection(this.db, 'groups', groupId, 'campaigns', campaignId, collectionName)
        );
        return snapshot.data().count;
      };

      const [chapters, npcs] = await Promise.all([
        countOf('chapters'),
        countOf('npcs')
      ]);

      return { chapters, npcs };
    }

    /**
     * Update an existing campaign
     * @param groupId ID of the group containing the campaign
     * @param campaignId ID of the campaign to update
     * @param data Fields to update on the campaign
     */
    public async updateCampaign(groupId: string, campaignId: string, data: Partial<Campaign>): Promise<void> {
      const userId = this.getCurrentUser()?.uid;
      if (!userId) {
        throw new Error('Not authenticated');
      }
      // The rules cap the name and description (T119); refused here first.
      assertTextFits(NAMED_DOCUMENT_TEXT_LIMITS, data as Record<string, unknown>);
      
      // Check if user is a member of this group
      const userProfileDoc = await this.userService.getGroupUserProfile(groupId, userId);
      if (!userProfileDoc) {
        throw new Error('You are not a member of this group');
      }
      
      try {
        const campaignRef = doc(this.db, 'groups', groupId, 'campaigns', campaignId);
        await updateDoc(campaignRef, {
          ...data,
          modifiedBy: userId,
          // The server's clock, as every record's edits carry (T132).
          modifiedAt: serverTimestamp()
        });
      } catch (error) {
        console.error(`CampaignService: Error updating campaign ${campaignId}:`, error);
        throw error;
      }
    }

    /**
     * Delete a campaign and everything that belongs to it.
     *
     * Firestore does not cascade-delete subcollections, and the client SDK
     * cannot enumerate them at all, so this delegates to the `deleteCampaign`
     * Cloud Function: it uses the Admin SDK's `recursiveDelete` to remove the
     * campaign document and all of its subcollections (npcs, locations,
     * quests, rumors, chapters, story-progress, saga), deletes every group
     * member's notes for this campaign (notes live outside the campaign
     * subtree, keyed by a campaignId field), and clears `activeCampaignId`
     * on any profile that pointed at it.
     * @param groupId ID of the group that owns the campaign
     * @param campaignId ID of the campaign to delete
     */
    public async deleteCampaign(groupId: string, campaignId: string): Promise<void> {
      const userId = this.getCurrentUser()?.uid;
      if (!userId) {
        throw new Error('Not authenticated');
      }

      try {
        // Call the Cloud Function instead of attempting to modify data directly.
        // `this.functions`, not a bare getFunctions(): that resolves the
        // default `us-central1` region, where nothing in this project is
        // deployed, and bypasses the emulator in development.
        const deleteCampaignFn = httpsCallable(this.functions, 'deleteCampaign');

        await deleteCampaignFn({ groupId, campaignId });
      } catch (err) {
        console.error('Error deleting campaign:', err);
        throw err;
      }
    }
  }

  export default CampaignService;