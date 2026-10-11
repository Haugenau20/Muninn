// src/core/types/user.ts
import { StoredImage } from "./storedImage";

/**
 * Character name entry with optional campaign association
 */
export interface CharacterNameEntry {
  /**
   * Unique identifier for this character name entry
   */
  id: string;
  
  /**
   * The character's name
   */
  name: string;
  
  /**
   * Optional campaign ID for campaign support
   */
  campaignId?: string;
}

/**
 * Global user profile information stored in the users collection
 */
export interface UserProfile {
  /** Optional unique ID (document ID in Firestore) */
  id: string;
  /** User's email address from Firebase Authentication */
  email: string;
  /** ID of the active group */
  activeGroupId?: string | null;
  /** Timestamp of last login */
  lastLogin: Date | string;
  /** Timestamp when the account was created */
  createdAt: Date | string;
  /** Account-scoped preferences. Theme lives here, not on a membership, so it
   *  cannot depend on which group was active at sign-in. */
  preferences?: {
    theme?: string;
    [key: string]: unknown;
  };
}

/**
 * Group-specific user profile stored in the groups/{groupId}/users collection
 */
export interface GroupUserProfile {
  /** Reference to the user's UID in users collection */
  userId: string;
  /** User's chosen unique username for this group */
  username: string;
  /** User's role in this group */
  role: 'admin' | 'member';
  /** When the user joined this group */
  joinedAt: Date | string;
  /** Optional character names associated with this user in this group */
  characters?: CharacterNameEntry[];
  /** ID of the active campaign in this group */
  activeCampaignId?: string | null;
  /** ID of the active character in this group */
  activeCharacterId?: string | null;
  /** User preferences for this group */
  preferences?: {
    /** UI theme preference */
    theme: string;
    [key: string]: any;
  };
}

/**
 * Group metadata stored in the groups collection
 */
export interface Group {
  /** Unique identifier for the group */
  id: string;
  /** Group name */
  name: string;
  /** Optional description */
  description?: string;
  /** When the group was created */
  createdAt: Date | string;
  /** UID of the user who created the group */
  createdBy: string;
  /** The party's crest, set by group admins only; null once removed */
  crest?: StoredImage | null;
}

/**
 * Campaign metadata stored in the groups/{groupId}/campaigns collection
 */
export interface Campaign {
  /** Unique identifier for the campaign */
  id: string;
  /** Reference to the parent group */
  groupId: string;
  /** Campaign name */
  name: string;
  /** Optional description */
  description?: string;
  /** When the campaign was created */
  createdAt: Date | string;
  /** UID of the user who created the campaign */
  createdBy: string;
  /** Whether the campaign is active */
  isActive: boolean;
  /** The picture behind the dashboard's banner, set by any member; null once removed */
  banner?: StoredImage | null;
}

/**
 * Username document stored in the groups/{groupId}/usernames collection
 */
export interface UsernameDocument {
  /** Reference to the user's UID in users collection */
  userId: string;
  /** Original username with preserved case for display */
  originalUsername: string;
  /** When the username was created */
  createdAt: Date | string;
}

/**
 * Username validation result
 */
export interface UsernameValidationResult {
  /** Whether the username is valid */
  isValid: boolean;
  /** Error message if not valid */
  error?: string;
  /** Whether the username is available */
  isAvailable?: boolean;
}
/**
 * What creating a group takes (T126). The `createGroup` function decides who
 * may: someone spending a founder link, or someone who has started a group
 * and fewer than three.
 */
export interface CreateGroupInput {
  /** The group's name. */
  name: string;
  /** What the group is, optionally. */
  description?: string;
  /** The founder's name in the new group, 3-20 characters, as on joining one. */
  username: string;
  /** A founder link to spend, from `/join?founder=…`. */
  founderToken?: string;
}
