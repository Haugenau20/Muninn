// src/utils/__dev__/generators/groupGenerator.ts

import { doc, setDoc } from 'firebase/firestore';
import { SAMPLE_MEMBERSHIPS, UserData, UserMapping } from './userGenerator';
import { HASHED_INVITATION_SCHEME, hashInvitationToken } from '../../../core/utils/registration-token';

// Create two groups with actual creator UID
export const createGroups = async (db: any, userMapping: UserMapping) => {
  const dmUid = userMapping['dm'];
  
  // Create Group 1: The Fellowship
  const group1Id = 'group1';
  const group1Data = {
    name: 'The Fellowship',
    description: 'A group of adventurers bound by a common quest to destroy the One Ring.',
    createdAt: new Date().toISOString(),
    createdBy: dmUid
  };
  
  await setDoc(doc(db, 'groups', group1Id), group1Data);
  console.log(`Created group: ${group1Data.name} (${group1Id})`);
  
  // Create Group 2: The Council of Elrond
  const group2Id = 'group2';
  const group2Data = {
    name: 'The Council of Elrond',
    description: 'Representatives of the free peoples of Middle-earth who gathered to decide the fate of the One Ring.',
    createdAt: new Date().toISOString(),
    createdBy: dmUid
  };
  
  await setDoc(doc(db, 'groups', group2Id), group2Data);
  console.log(`Created group: ${group2Data.name} (${group2Id})`);
  
  return { group1Id, group2Id };
};

// Add users to groups with appropriate roles
export const addUsersToGroups = async (db: any, users: UserData[], groups: { group1Id: string, group2Id: string }, formattedDate: string) => {
  // Process each user
  for (const user of users) {
    // Membership comes from the same table the global profile reads
    const membership = SAMPLE_MEMBERSHIPS[user.username] ?? { groups: [], admin: false };
    const userGroups = membership.groups.map(g => (g === 'group1' ? groups.group1Id : groups.group2Id));
    const isAdmin = membership.admin;
    
    // Add user to each applicable group
    for (const groupId of userGroups) {
      // Create user membership in group
      const groupUserData = {
        username: user.username,
        role: isAdmin ? 'admin' : 'member',
        joinedAt: formattedDate,
        // `{id, name}` entries, as `CharacterNameEntry` and the profile page
        // expect; a bare string crashed the page's character row.
        characters: isAdmin ? [] : [{ id: `${user.id}-character`, name: `${user.username}'s Character` }],
        activeCampaignId: groupId === groups.group1Id ? 'campaign1-1' : 'campaign2-1', // Set default active campaign
        preferences: { theme: 'dark', notifications: true }
      };
      
      await setDoc(doc(db, 'groups', groupId, 'users', user.id), groupUserData);
      console.log(`Added user ${user.username} to group ${groupId} as ${groupUserData.role}`);
      
      // Also create username document for lookup
      await setDoc(doc(db, 'groups', groupId, 'usernames', user.username.toLowerCase()), {
        userId: user.id,
        originalUsername: user.username,
        createdAt: formattedDate
      });
    }
  }
  
  // Create registration tokens for each group
  await createGroupTokens(db, groups.group1Id, users, formattedDate);
  await createGroupTokens(db, groups.group2Id, users, formattedDate);
};

// Helper to create tokens for a group
const createGroupTokens = async (db: any, groupId: string, users: UserData[], formattedDate: string) => {
  // Find the admin (DM) for this group
  const dmUser = users.find(u => u.username === 'DungeonMaster');
  if (!dmUser) return;

  // Determine which users should have tokens in this group
  let tokenUsers = [];
  
  if (groupId === 'group1') {
    // Group 1 tokens: Aragorn, Gandalf, Gimli
    tokenUsers = users.filter(u => ['Aragorn', 'Gandalf', 'Gimli'].includes(u.username));
  } else {
    // Group 2 tokens: Aragorn, Frodo, Samwise
    tokenUsers = users.filter(u => ['Aragorn', 'Frodo', 'Samwise'].includes(u.username));
  }
  
  // Create tokens
  for (let i = 0; i < tokenUsers.length; i++) {
    const user = tokenUsers[i];
    
    // Stored under the token's hash, as `createInvitation` stores one (T145).
    // These are spent, so no sealed copy: nobody needs their links again.
    const tokenId = await hashInvitationToken(`token${i+1}-${groupId}`);
    if (!tokenId) throw new Error('Web Crypto is needed to seed invitations');
    const token = {
      id: tokenId,
      scheme: HASHED_INVITATION_SCHEME,
      createdAt: formattedDate,
      createdBy: dmUser.id,
      used: true,
      usedAt: formattedDate,
      usedBy: user.id,
      notes: `Token for ${user.username}`
    };
    
    await setDoc(doc(db, 'groups', groupId, 'registrationTokens', token.id), token);
    console.log(`Created token for ${user.username} in group ${groupId}`);
  }
  
  // Create one unused token for future members. Its link cannot be copied
  // again: only `createInvitation` can seal a token, and this one is not
  // sealed, so the admin page says to revoke it and invite again.
  const unusedTokenId = await hashInvitationToken(`token-unused-${groupId}`);
  if (!unusedTokenId) throw new Error('Web Crypto is needed to seed invitations');
  const unusedToken = {
    id: unusedTokenId,
    scheme: HASHED_INVITATION_SCHEME,
    createdAt: formattedDate,
    createdBy: dmUser.id,
    used: false,
    notes: 'Spare token for future players'
  };
  
  await setDoc(doc(db, 'groups', groupId, 'registrationTokens', unusedToken.id), unusedToken);
  console.log(`Created unused token for group ${groupId}`);
};