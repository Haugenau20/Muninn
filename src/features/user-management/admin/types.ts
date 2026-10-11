// src/features/user-management/admin/types.ts

/**
 * A member of the active group, as `useGroups().getAllUsers()` returns them.
 *
 * Typed here rather than `any[]` at every call site, which is what the two
 * views this replaced used. The service is untyped, so these are the fields
 * the admin surfaces actually read -- not a claim about the whole document.
 */
export interface GroupMember {
  /**
   * The document id, which **is** the Firebase uid.
   *
   * Group profiles live at `groups/{groupId}/users/{userId}`, so the id of the
   * document is the uid of the person. `GroupService.getGroupUsers` maps it to
   * `id`; use {@link memberId} rather than reaching for it directly.
   */
  id?: string;
  /**
   * The same document id: `getGroupUsers` overwrites whatever `userId` the
   * document stores, which is client-written. Never read it for identity.
   */
  userId?: string;
  username?: string;
  role?: string;
  joinedAt?: Date | string | number;
}

/**
 * The uid for a member: the document id, and nothing the document stores.
 *
 * Exists because getting this wrong is silent and expensive. The view this
 * replaced read `userData.userId`, which no group-user document actually
 * carries -- so it was `undefined` for everyone, nobody ever matched the
 * signed-in user, and the consequences were that the Remove button appeared on
 * your own row and that pressing it called `deleteUser(undefined)`. Preferring
 * a stored `userId` where one existed was worse: a member could write another
 * member's uid there, and removing the forger's row removed the other member
 * (SEC-002, T080).
 */
export function memberId(member: GroupMember): string | undefined {
  return member.id;
}

/**
 * A registration token for the active group.
 *
 * Only unaccepted ones are ever rendered: a used token *is* the member row
 * above it, and no action on it is available -- you cannot un-use one.
 */
export interface RegistrationToken {
  /**
   * The invitation's document id: its token's hash (T145), or for one made
   * before that, the token itself. Never put in a link: the link's token
   * comes from `revealRegistrationToken`.
   */
  id: string;
  notes?: string;
  used?: boolean;
  createdAt?: Date | string | number;
  /**
   * When the invitation stops working. Absent on every token minted before
   * T013, which never expire -- see `core/utils/registration-token`.
   */
  expiresAt?: Date | string | number;
  usedAt?: Date | string | number;
  usedBy?: string;
}
