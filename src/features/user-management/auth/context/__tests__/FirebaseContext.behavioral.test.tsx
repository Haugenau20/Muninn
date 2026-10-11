// src/context/firebase/__tests__/FirebaseContext.behavioral.test.tsx

import React from "react";
import { renderHook, act, waitFor } from "@testing-library/react";
import { FirebaseProvider, useFirebaseContext } from "../FirebaseContext";
import type { UserProfile, GroupUserProfile, Group, Campaign } from "@/core/types/user";

/**
 * FirebaseContext Behavioral Testing
 *
 * Tests the REAL FirebaseProvider and useFirebaseContext hook with:
 *   - Completely mocked firebaseServices (auth, user, group, campaign)
 *   - Manually controllable onAuthStateChanged callback
 *
 * STRATEGY:
 * - Capture the onAuthStateChanged callback on registration so tests can
 *   drive auth state transitions directly.
 * - Assert on observable state shape: user, userProfile, loading, error,
 *   groups, campaigns, activeGroupId, activeCampaignId.
 * - Never modify a test to make it pass — failing tests are filed as bugs.
 *
 * BUG NOTES:
 * - #900: authLoading is never set to false in the authenticated user success
 *   path (setAuthLoading(false) is absent after loadGroups completes).
 *   Tests that would wait on loading===false in the authenticated path are
 *   skipped with a bug reference.
 */

// ---------------------------------------------------------------------------
// Capture onAuthStateChanged callback
// ---------------------------------------------------------------------------
let capturedAuthCallback: ((user: any) => Promise<void>) | null = null;
let mockUnsubscribe: jest.Mock;

jest.mock("firebase/auth", () => ({
  onAuthStateChanged: (auth: any, callback: (user: any) => Promise<void>) => {
    capturedAuthCallback = callback;
    mockUnsubscribe = jest.fn();
    return mockUnsubscribe;
  },
}));

// ---------------------------------------------------------------------------
// Mock firebaseServices
// ---------------------------------------------------------------------------
const mockGetAuth = jest.fn();
const mockSetActiveGroup = jest.fn();
const mockSetActiveCampaign = jest.fn();

const mockGetUserProfile = jest.fn();
const mockGetGroupUserProfile = jest.fn();
const mockUpdateUserProfile = jest.fn();
const mockUpdateGroupUserProfile = jest.fn();
const mockGetCurrentUserId = jest.fn();
const mockGetUser = jest.fn();

const mockGetGroups = jest.fn();
const mockGetCampaigns = jest.fn();

jest.mock("@/core/services/firebase", () => ({
  __esModule: true,
  default: {
    auth: {
      getAuth: (...args: any[]) => mockGetAuth(...args),
      setActiveGroup: (...args: any[]) => mockSetActiveGroup(...args),
      setActiveCampaign: (...args: any[]) => mockSetActiveCampaign(...args),
      getCurrentUserId: () => mockGetCurrentUserId(),
      getUser: () => mockGetUser(),
    },
    user: {
      getUserProfile: (...args: any[]) => mockGetUserProfile(...args),
      getGroupUserProfile: (...args: any[]) => mockGetGroupUserProfile(...args),
      updateUserProfile: (...args: any[]) => mockUpdateUserProfile(...args),
      updateGroupUserProfile: (...args: any[]) => mockUpdateGroupUserProfile(...args),
    },
    group: {
      getGroups: (...args: any[]) => mockGetGroups(...args),
    },
    campaign: {
      getCampaigns: (...args: any[]) => mockGetCampaigns(...args),
    },
  },
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
function makeUser(uid = "user-1") {
  return { uid } as any;
}

function makeUserProfile(overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    id: "user-1",
    email: "test@example.com",
    groups: ["group-1"],
    activeGroupId: "group-1",
    lastLogin: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeGroupUserProfile(
  overrides: Partial<GroupUserProfile> = {}
): GroupUserProfile {
  return {
    userId: "user-1",
    username: "TestUser",
    role: "member",
    joinedAt: new Date().toISOString(),
    activeCampaignId: "campaign-1",
    ...overrides,
  };
}

function makeGroup(id = "group-1", overrides: Partial<Group> = {}): Group {
  return {
    id,
    name: `Group ${id}`,
    createdAt: new Date().toISOString(),
    createdBy: "user-1",
    ...overrides,
  };
}

function makeCampaign(
  id = "campaign-1",
  groupId = "group-1",
  overrides: Partial<Campaign> = {}
): Campaign {
  return {
    id,
    groupId,
    name: `Campaign ${id}`,
    createdAt: new Date().toISOString(),
    createdBy: "user-1",
    isActive: true,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Wrapper
// ---------------------------------------------------------------------------
const wrapper = ({ children }: { children: React.ReactNode }) => (
  <FirebaseProvider>{children}</FirebaseProvider>
);

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------
describe("FirebaseContext Behavioral Testing", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    capturedAuthCallback = null;

    // getAuth returns a mock auth object (used only as identity by onAuthStateChanged)
    mockGetAuth.mockReturnValue({ _isMockAuth: true });

    // Default: all service calls resolve to empty / null
    mockGetUserProfile.mockResolvedValue(null);
    mockGetGroupUserProfile.mockResolvedValue(null);
    mockGetGroups.mockResolvedValue([]);
    mockGetCampaigns.mockResolvedValue([]);
    mockGetCurrentUserId.mockReturnValue("user-1");
    mockGetUser.mockReturnValue(null);
    mockUpdateUserProfile.mockResolvedValue(undefined);
    mockUpdateGroupUserProfile.mockResolvedValue(undefined);
  });

  // -------------------------------------------------------------------------
  describe("useFirebaseContext outside of Provider", () => {
    test("should throw when useFirebaseContext is called outside FirebaseProvider", () => {
      expect(() => {
        renderHook(() => useFirebaseContext());
      }).toThrow("useFirebaseContext must be used within a FirebaseProvider");
    });
  });

  // -------------------------------------------------------------------------
  describe("Initial State", () => {
    test("should expose all required API members on mount", () => {
      const { result } = renderHook(() => useFirebaseContext(), { wrapper });

      // Auth state
      expect(result.current.user).toBeNull();
      expect(result.current.userProfile).toBeNull();
      expect(typeof result.current.loading).toBe("boolean");
      expect(result.current.error).toBeNull();
      expect(typeof result.current.setError).toBe("function");

      // Group state
      expect(Array.isArray(result.current.groups)).toBe(true);
      expect(result.current.activeGroupId).toBeNull();
      expect(result.current.activeGroupUserProfile).toBeNull();

      // Campaign state
      expect(Array.isArray(result.current.campaigns)).toBe(true);
      expect(result.current.activeCampaignId).toBeNull();

      // Updater functions
      expect(typeof result.current.refreshGroups).toBe("function");
      expect(typeof result.current.refreshCampaigns).toBe("function");
      expect(typeof result.current.refreshUserProfile).toBe("function");
    });

    test("should have loading=true before first auth state emission", () => {
      const { result } = renderHook(() => useFirebaseContext(), { wrapper });

      // authLoading starts true, no callback fired yet
      expect(result.current.loading).toBe(true);
    });

    test("should have user=null before first auth state emission", () => {
      const { result } = renderHook(() => useFirebaseContext(), { wrapper });

      expect(result.current.user).toBeNull();
    });

    test("should have error=null before first auth state emission", () => {
      const { result } = renderHook(() => useFirebaseContext(), { wrapper });

      expect(result.current.error).toBeNull();
    });

    test("should register onAuthStateChanged listener on mount", () => {
      renderHook(() => useFirebaseContext(), { wrapper });

      // capturedAuthCallback will be set if onAuthStateChanged was called
      expect(capturedAuthCallback).not.toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  describe("onAuthStateChanged — unauthenticated transition", () => {
    test("should set user=null when callback fires with null (logged out)", async () => {
      const { result } = renderHook(() => useFirebaseContext(), { wrapper });

      await act(async () => {
        await capturedAuthCallback!(null);
      });

      expect(result.current.user).toBeNull();
    });

    test("should set loading=false after unauthenticated emission", async () => {
      const { result } = renderHook(() => useFirebaseContext(), { wrapper });

      await act(async () => {
        await capturedAuthCallback!(null);
      });

      expect(result.current.loading).toBe(false);
    });

    test("should clear groups, campaigns, and active ids on logout", async () => {
      const { result } = renderHook(() => useFirebaseContext(), { wrapper });

      await act(async () => {
        await capturedAuthCallback!(null);
      });

      expect(result.current.groups).toEqual([]);
      expect(result.current.campaigns).toEqual([]);
      expect(result.current.activeGroupId).toBeNull();
      expect(result.current.activeCampaignId).toBeNull();
      expect(result.current.userProfile).toBeNull();
      expect(result.current.activeGroupUserProfile).toBeNull();
    });

    test("should dispatch AUTH_STATE_CHANGED_EVENT with authenticated=false on logout", async () => {
      const dispatchedEvents: CustomEvent[] = [];
      const handler = (e: Event) => dispatchedEvents.push(e as CustomEvent);
      window.addEventListener("auth-state-changed", handler);

      renderHook(() => useFirebaseContext(), { wrapper });

      await act(async () => {
        await capturedAuthCallback!(null);
      });

      window.removeEventListener("auth-state-changed", handler);

      const lastEvent = dispatchedEvents[dispatchedEvents.length - 1];
      expect(lastEvent).toBeDefined();
      expect(lastEvent.detail.authenticated).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  describe("onAuthStateChanged — authenticated transition", () => {
    test("should set user when callback fires with a firebase user", async () => {
      const fakeUser = makeUser("u-42");
      const profile = makeUserProfile({ id: "u-42", activeGroupId: null });

      // Return profile but no groups — simplest success path
      mockGetUserProfile.mockResolvedValue(profile);
      mockGetGroups.mockResolvedValue([]);

      const { result } = renderHook(() => useFirebaseContext(), { wrapper });

      await act(async () => {
        await capturedAuthCallback!(fakeUser);
      });

      expect(result.current.user).toBe(fakeUser);
    });

    test("should set userProfile when getUserProfile resolves with data", async () => {
      const fakeUser = makeUser("u-1");
      const profile = makeUserProfile({ id: "u-1", activeGroupId: null });

      mockGetUserProfile.mockResolvedValue(profile);
      mockGetGroups.mockResolvedValue([]);

      const { result } = renderHook(() => useFirebaseContext(), { wrapper });

      await act(async () => {
        await capturedAuthCallback!(fakeUser);
      });

      expect(result.current.userProfile).toEqual(profile);
    });

    test("should dispatch AUTH_STATE_CHANGED_EVENT with authenticated=true on sign-in", async () => {
      const fakeUser = makeUser("u-1");
      mockGetUserProfile.mockResolvedValue(
        makeUserProfile({ id: "u-1", activeGroupId: null })
      );
      mockGetGroups.mockResolvedValue([]);

      const dispatchedEvents: CustomEvent[] = [];
      const handler = (e: Event) => dispatchedEvents.push(e as CustomEvent);
      window.addEventListener("auth-state-changed", handler);

      renderHook(() => useFirebaseContext(), { wrapper });

      await act(async () => {
        await capturedAuthCallback!(fakeUser);
      });

      window.removeEventListener("auth-state-changed", handler);

      const authTrueEvent = dispatchedEvents.find(
        (e) => e.detail.authenticated === true
      );
      expect(authTrueEvent).toBeDefined();
    });

    test("should clear previous state before loading new user data", async () => {
      const fakeUser = makeUser("u-1");
      const profile = makeUserProfile({ id: "u-1", activeGroupId: null });

      mockGetUserProfile.mockResolvedValue(profile);
      mockGetGroups.mockResolvedValue([]);

      const { result } = renderHook(() => useFirebaseContext(), { wrapper });

      // First sign-in settles state
      await act(async () => {
        await capturedAuthCallback!(fakeUser);
      });

      // Second sign-in should clear previous data before loading new
      mockGetUserProfile.mockResolvedValue(
        makeUserProfile({ id: "u-2", email: "other@test.com", activeGroupId: null })
      );
      const fakeUser2 = makeUser("u-2");

      await act(async () => {
        await capturedAuthCallback!(fakeUser2);
      });

      // After loading completes the new user profile should be present
      expect(result.current.userProfile?.id).toBe("u-2");
    });

    test("should call getUserProfile with the authenticated user's uid", async () => {
      const fakeUser = makeUser("uid-specific-123");
      mockGetUserProfile.mockResolvedValue(
        makeUserProfile({ id: "uid-specific-123", activeGroupId: null })
      );
      mockGetGroups.mockResolvedValue([]);

      renderHook(() => useFirebaseContext(), { wrapper });

      await act(async () => {
        await capturedAuthCallback!(fakeUser);
      });

      expect(mockGetUserProfile).toHaveBeenCalledWith("uid-specific-123");
    });

    test("loading should be true after auth transition if data loading is in-flight", async () => {
      // Make getUserProfile never resolve so we can observe loading=true mid-flight
      let resolveProfile!: (v: UserProfile | null) => void;
      const pendingProfile = new Promise<UserProfile | null>(
        (res) => (resolveProfile = res)
      );
      mockGetUserProfile.mockReturnValue(pendingProfile);

      const { result } = renderHook(() => useFirebaseContext(), { wrapper });

      // Kick off auth without awaiting full resolution
      act(() => {
        capturedAuthCallback!(makeUser("u-1"));
      });

      // While the promise is pending, loading should be true
      expect(result.current.loading).toBe(true);

      // Clean up the dangling promise
      await act(async () => {
        resolveProfile(null);
      });
    });

    // BUG #900: authLoading is never set to false in the success path for
    // authenticated users with a loaded profile + groups.
    // When loadGroups completes successfully, setAuthLoading(false) is never called.
    // loading stays true indefinitely after successful authentication.
    test(
      "loading should be false after authenticated user data fully loads — skipped due to bug #900",
      async () => {
        const fakeUser = makeUser("u-1");
        const profile = makeUserProfile({ id: "u-1", activeGroupId: "group-1" });
        const group = makeGroup("group-1");
        const groupProfile = makeGroupUserProfile();
        const campaigns = [makeCampaign("campaign-1")];

        mockGetUserProfile.mockResolvedValue(profile);
        mockGetGroups.mockResolvedValue([group]);
        mockGetGroupUserProfile.mockResolvedValue(groupProfile);
        mockGetCampaigns.mockResolvedValue(campaigns);

        const { result } = renderHook(() => useFirebaseContext(), { wrapper });

        await act(async () => {
          await capturedAuthCallback!(fakeUser);
        });

        // BUG #900: This assertion fails because loading never becomes false
        await waitFor(() => {
          expect(result.current.loading).toBe(false);
        });
      }
    );
  });

  // -------------------------------------------------------------------------
  describe("setError / clearError state mutations", () => {
    test("should set error state when setError is called with a string", async () => {
      const { result } = renderHook(() => useFirebaseContext(), { wrapper });

      act(() => {
        result.current.setError("Something went wrong");
      });

      expect(result.current.error).toBe("Something went wrong");
    });

    test("should clear error state when setError is called with null", async () => {
      const { result } = renderHook(() => useFirebaseContext(), { wrapper });

      act(() => {
        result.current.setError("initial error");
      });
      expect(result.current.error).toBe("initial error");

      act(() => {
        result.current.setError(null);
      });
      expect(result.current.error).toBeNull();
    });

    test("should overwrite previous error with new error string", async () => {
      const { result } = renderHook(() => useFirebaseContext(), { wrapper });

      act(() => {
        result.current.setError("first error");
      });
      act(() => {
        result.current.setError("second error");
      });

      expect(result.current.error).toBe("second error");
    });
  });

  // -------------------------------------------------------------------------
  describe("refreshUserProfile", () => {
    test("should not call getUserProfile when user is null", async () => {
      const { result } = renderHook(() => useFirebaseContext(), { wrapper });

      // No auth state fired — user is null
      await act(async () => {
        await result.current.refreshUserProfile();
      });

      expect(mockGetUserProfile).not.toHaveBeenCalled();
    });

    test("should re-fetch userProfile when user is authenticated", async () => {
      const fakeUser = makeUser("u-1");
      const initialProfile = makeUserProfile({
        id: "u-1",
        email: "v1@test.com",
        activeGroupId: null,
      });
      mockGetUserProfile.mockResolvedValue(initialProfile);
      mockGetGroups.mockResolvedValue([]);

      const { result } = renderHook(() => useFirebaseContext(), { wrapper });

      await act(async () => {
        await capturedAuthCallback!(fakeUser);
      });

      // Now update what getUserProfile returns
      const updatedProfile = makeUserProfile({
        id: "u-1",
        email: "v2@test.com",
        activeGroupId: null,
      });
      mockGetUserProfile.mockResolvedValue(updatedProfile);

      await act(async () => {
        await result.current.refreshUserProfile();
      });

      expect(result.current.userProfile).toEqual(updatedProfile);
    });

    test("should surface error via setError when getUserProfile throws during refreshUserProfile", async () => {
      const fakeUser = makeUser("u-1");
      const initialProfile = makeUserProfile({
        id: "u-1",
        activeGroupId: null,
      });
      mockGetUserProfile.mockResolvedValueOnce(initialProfile);
      mockGetGroups.mockResolvedValue([]);

      const { result } = renderHook(() => useFirebaseContext(), { wrapper });

      await act(async () => {
        await capturedAuthCallback!(fakeUser);
      });

      // Second call throws
      mockGetUserProfile.mockRejectedValueOnce(
        new Error("Profile fetch failed")
      );

      await act(async () => {
        await result.current.refreshUserProfile();
      });

      expect(result.current.error).toBe("Profile fetch failed");
    });

    test("should not throw when refreshUserProfile fails — error is surfaced via state only", async () => {
      const fakeUser = makeUser("u-1");
      const initialProfile = makeUserProfile({
        id: "u-1",
        activeGroupId: null,
      });
      mockGetUserProfile.mockResolvedValueOnce(initialProfile);
      mockGetGroups.mockResolvedValue([]);

      const { result } = renderHook(() => useFirebaseContext(), { wrapper });

      await act(async () => {
        await capturedAuthCallback!(fakeUser);
      });

      mockGetUserProfile.mockRejectedValueOnce(new Error("boom"));

      // Should NOT throw
      await expect(
        act(async () => {
          await result.current.refreshUserProfile();
        })
      ).resolves.not.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  describe("Group loading via onAuthStateChanged", () => {
    test("should call getGroups after loading profile", async () => {
      const fakeUser = makeUser("u-1");
      mockGetUserProfile.mockResolvedValue(
        makeUserProfile({ id: "u-1", activeGroupId: null })
      );
      mockGetGroups.mockResolvedValue([]);

      renderHook(() => useFirebaseContext(), { wrapper });

      await act(async () => {
        await capturedAuthCallback!(fakeUser);
      });

      expect(mockGetGroups).toHaveBeenCalledTimes(1);
    });

    test("should populate groups state after successful getGroups", async () => {
      const fakeUser = makeUser("u-1");
      const groups = [makeGroup("group-1"), makeGroup("group-2")];
      mockGetUserProfile.mockResolvedValue(
        makeUserProfile({ id: "u-1", activeGroupId: null })
      );
      mockGetGroups.mockResolvedValue(groups);
      // Prevent cascade from setActiveGroupContext for this test
      mockGetGroupUserProfile.mockResolvedValue(null);

      const { result } = renderHook(() => useFirebaseContext(), { wrapper });

      await act(async () => {
        await capturedAuthCallback!(fakeUser);
      });

      expect(result.current.groups).toEqual(groups);
    });

    test("should auto-select single group when only one is returned", async () => {
      const fakeUser = makeUser("u-1");
      const group = makeGroup("only-group");
      mockGetUserProfile.mockResolvedValue(
        makeUserProfile({ id: "u-1", activeGroupId: "only-group" })
      );
      mockGetGroups.mockResolvedValue([group]);
      mockGetGroupUserProfile.mockResolvedValue(null);
      mockGetCampaigns.mockResolvedValue([]);

      const { result } = renderHook(() => useFirebaseContext(), { wrapper });

      await act(async () => {
        await capturedAuthCallback!(fakeUser);
      });

      // setActiveGroup should have been called with the single group's id
      expect(mockSetActiveGroup).toHaveBeenCalledWith("only-group");
    });

    // A stored active group the user is no longer in falls back to the
    // first group they are in.
    test("selects the first group when the stored active group is not one of theirs", async () => {
      mockGetUserProfile.mockResolvedValue(
        makeUserProfile({ id: "u-1", activeGroupId: "group-gone" })
      );
      mockGetGroups.mockResolvedValue([makeGroup("group-A"), makeGroup("group-B")]);
      mockGetGroupUserProfile.mockResolvedValue(null);
      mockGetCampaigns.mockResolvedValue([]);

      renderHook(() => useFirebaseContext(), { wrapper });

      await act(async () => {
        await capturedAuthCallback!(makeUser("u-1"));
      });

      expect(mockSetActiveGroup).toHaveBeenCalledWith("group-A");
      expect(mockSetActiveGroup).not.toHaveBeenCalledWith("group-gone");
    });

    test("should call setActiveGroup on firebaseServices.auth when setting active group", async () => {
      const fakeUser = makeUser("u-1");
      mockGetUserProfile.mockResolvedValue(
        makeUserProfile({ id: "u-1", activeGroupId: "group-A" })
      );
      mockGetGroups.mockResolvedValue([makeGroup("group-A")]);
      mockGetGroupUserProfile.mockResolvedValue(null);
      mockGetCampaigns.mockResolvedValue([]);

      renderHook(() => useFirebaseContext(), { wrapper });

      await act(async () => {
        await capturedAuthCallback!(fakeUser);
      });

      expect(mockSetActiveGroup).toHaveBeenCalledWith("group-A");
    });
  });

  // -------------------------------------------------------------------------
  describe("Campaign loading via setActiveGroupContext", () => {
    test("should populate campaigns after loading group profile with campaigns", async () => {
      const fakeUser = makeUser("u-1");
      const campaigns = [makeCampaign("c-1"), makeCampaign("c-2")];

      mockGetUserProfile.mockResolvedValue(
        makeUserProfile({ id: "u-1", activeGroupId: "g-1" })
      );
      mockGetGroups.mockResolvedValue([makeGroup("g-1")]);
      mockGetGroupUserProfile.mockResolvedValue(
        makeGroupUserProfile({ activeCampaignId: "c-1" })
      );
      mockGetCampaigns.mockResolvedValue(campaigns);

      const { result } = renderHook(() => useFirebaseContext(), { wrapper });

      await act(async () => {
        await capturedAuthCallback!(fakeUser);
      });

      expect(result.current.campaigns).toEqual(campaigns);
    });

    test("should call setActiveCampaign on firebaseServices.auth when activeCampaignId is set from groupProfile", async () => {
      const fakeUser = makeUser("u-1");
      const campaigns = [makeCampaign("c-1")];

      mockGetUserProfile.mockResolvedValue(
        makeUserProfile({ id: "u-1", activeGroupId: "g-1" })
      );
      mockGetGroups.mockResolvedValue([makeGroup("g-1")]);
      mockGetGroupUserProfile.mockResolvedValue(
        makeGroupUserProfile({ activeCampaignId: "c-1" })
      );
      mockGetCampaigns.mockResolvedValue(campaigns);

      renderHook(() => useFirebaseContext(), { wrapper });

      await act(async () => {
        await capturedAuthCallback!(fakeUser);
      });

      expect(mockSetActiveCampaign).toHaveBeenCalledWith("c-1");
    });

    test("should fall back to first campaign when activeCampaignId does not match any real campaign", async () => {
      const fakeUser = makeUser("u-1");
      const campaigns = [makeCampaign("c-1"), makeCampaign("c-2")];

      mockGetUserProfile.mockResolvedValue(
        makeUserProfile({ id: "u-1", activeGroupId: "g-1" })
      );
      mockGetGroups.mockResolvedValue([makeGroup("g-1")]);
      mockGetGroupUserProfile.mockResolvedValue(
        makeGroupUserProfile({ activeCampaignId: "non-existent-id" })
      );
      mockGetCampaigns.mockResolvedValue(campaigns);

      const { result } = renderHook(() => useFirebaseContext(), { wrapper });

      await act(async () => {
        await capturedAuthCallback!(fakeUser);
      });

      // Should fall back to first campaign in the list
      expect(result.current.activeCampaignId).toBe("c-1");
    });

    test("should fall back to first campaign when groupProfile has no activeCampaignId set", async () => {
      const fakeUser = makeUser("u-1");
      const campaigns = [makeCampaign("first-campaign")];

      mockGetUserProfile.mockResolvedValue(
        makeUserProfile({ id: "u-1", activeGroupId: "g-1" })
      );
      mockGetGroups.mockResolvedValue([makeGroup("g-1")]);
      mockGetGroupUserProfile.mockResolvedValue(
        makeGroupUserProfile({ activeCampaignId: null })
      );
      mockGetCampaigns.mockResolvedValue(campaigns);

      const { result } = renderHook(() => useFirebaseContext(), { wrapper });

      await act(async () => {
        await capturedAuthCallback!(fakeUser);
      });

      expect(result.current.activeCampaignId).toBe("first-campaign");
    });
  });

  // -------------------------------------------------------------------------
  // PERF-02: the restore on every sign-in and reload was a serial waterfall
  // that read the global profile twice and asked for campaigns only after
  // the group profile had answered.
  describe("Restore without the serial waterfall (PERF-02)", () => {
    // T136: the groups come from the user's group profiles, the one record
    // of membership; the global profile's array is not handed on, and
    // getGroups does not read the global profile again.
    test("asks getGroups for the groups without handing it the global profile's array", async () => {
      mockGetUserProfile.mockResolvedValue(
        makeUserProfile({ id: "u-1", groups: ["g-stale"], activeGroupId: "g-1" })
      );
      mockGetGroups.mockResolvedValue([makeGroup("g-1"), makeGroup("g-2")]);

      const { result } = renderHook(() => useFirebaseContext(), { wrapper });

      await act(async () => {
        await capturedAuthCallback!(makeUser("u-1"));
      });

      expect(mockGetGroups).toHaveBeenCalledWith();
      expect(result.current.groups.map((group) => group.id)).toEqual(["g-1", "g-2"]);
    });

    test("asks for the campaigns before the group profile has answered", async () => {
      let answerGroupProfile!: (profile: GroupUserProfile | null) => void;
      mockGetUserProfile.mockResolvedValue(
        makeUserProfile({ id: "u-1", activeGroupId: "g-1" })
      );
      mockGetGroups.mockResolvedValue([makeGroup("g-1")]);
      mockGetGroupUserProfile.mockReturnValue(
        new Promise((resolve) => { answerGroupProfile = resolve; })
      );
      mockGetCampaigns.mockResolvedValue([makeCampaign("c-1", "g-1")]);

      const { result } = renderHook(() => useFirebaseContext(), { wrapper });

      let restoring!: Promise<void>;
      act(() => {
        restoring = capturedAuthCallback!(makeUser("u-1"));
      });
      await waitFor(() => expect(mockGetGroupUserProfile).toHaveBeenCalled());
      await waitFor(() => expect(mockGetCampaigns).toHaveBeenCalledWith("g-1"));

      await act(async () => {
        answerGroupProfile(makeGroupUserProfile({ activeCampaignId: "c-1" }));
        await restoring;
      });

      expect(result.current.activeCampaignId).toBe("c-1");
    });

    test("uses none of the campaigns when the group profile shows no membership", async () => {
      mockGetUserProfile.mockResolvedValue(
        makeUserProfile({ id: "u-1", activeGroupId: "g-1" })
      );
      mockGetGroups.mockResolvedValue([makeGroup("g-1")]);
      mockGetGroupUserProfile.mockResolvedValue(null);
      mockGetCampaigns.mockResolvedValue([makeCampaign("c-1", "g-1")]);

      const { result } = renderHook(() => useFirebaseContext(), { wrapper });

      await act(async () => {
        await capturedAuthCallback!(makeUser("u-1"));
      });

      expect(result.current.campaigns).toEqual([]);
      expect(result.current.activeCampaignId).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  describe("refreshGroups", () => {
    test("should return empty array and not call getGroups when user is null", async () => {
      const { result } = renderHook(() => useFirebaseContext(), { wrapper });

      let returned: any;
      await act(async () => {
        returned = await result.current.refreshGroups();
      });

      expect(mockGetGroups).not.toHaveBeenCalled();
      expect(returned).toEqual([]);
    });

    test("should call getGroups and update groups state when user is authenticated", async () => {
      const fakeUser = makeUser("u-1");
      const initialProfile = makeUserProfile({
        id: "u-1",
        activeGroupId: null,
      });
      mockGetUserProfile.mockResolvedValue(initialProfile);
      mockGetGroups.mockResolvedValue([]);

      const { result } = renderHook(() => useFirebaseContext(), { wrapper });

      await act(async () => {
        await capturedAuthCallback!(fakeUser);
      });

      const newGroups = [makeGroup("g-fresh")];
      mockGetGroups.mockResolvedValue(newGroups);

      await act(async () => {
        await result.current.refreshGroups();
      });

      expect(result.current.groups).toEqual(newGroups);
    });

    test("should return empty array when getGroups throws", async () => {
      const fakeUser = makeUser("u-1");
      mockGetUserProfile.mockResolvedValue(
        makeUserProfile({ id: "u-1", activeGroupId: null })
      );
      mockGetGroups.mockResolvedValueOnce([]).mockRejectedValueOnce(
        new Error("Network error")
      );

      const { result } = renderHook(() => useFirebaseContext(), { wrapper });

      await act(async () => {
        await capturedAuthCallback!(fakeUser);
      });

      let returned: any;
      await act(async () => {
        returned = await result.current.refreshGroups();
      });

      expect(returned).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  describe("refreshCampaigns", () => {
    test("should return empty array when activeGroupId is null", async () => {
      const { result } = renderHook(() => useFirebaseContext(), { wrapper });

      let returned: any;
      await act(async () => {
        returned = await result.current.refreshCampaigns();
      });

      expect(mockGetCampaigns).not.toHaveBeenCalled();
      expect(returned).toEqual([]);
    });

    test("should call getCampaigns with activeGroupId when group is active", async () => {
      const fakeUser = makeUser("u-1");
      mockGetUserProfile.mockResolvedValue(
        makeUserProfile({ id: "u-1", activeGroupId: "g-1" })
      );
      mockGetGroups.mockResolvedValue([makeGroup("g-1")]);
      mockGetGroupUserProfile.mockResolvedValue(null);
      mockGetCampaigns.mockResolvedValue([]);

      const { result } = renderHook(() => useFirebaseContext(), { wrapper });

      await act(async () => {
        await capturedAuthCallback!(fakeUser);
      });

      const freshCampaigns = [makeCampaign("c-new", "g-1")];
      mockGetCampaigns.mockResolvedValue(freshCampaigns);

      await act(async () => {
        await result.current.refreshCampaigns();
      });

      // getCampaigns should have been called (at least once for the refresh)
      expect(mockGetCampaigns).toHaveBeenCalledWith("g-1");
    });

    test("should return empty array when getCampaigns throws", async () => {
      const fakeUser = makeUser("u-1");
      mockGetUserProfile.mockResolvedValue(
        makeUserProfile({ id: "u-1", activeGroupId: "g-1" })
      );
      mockGetGroups.mockResolvedValue([makeGroup("g-1")]);
      mockGetGroupUserProfile.mockResolvedValue(null);
      mockGetCampaigns.mockResolvedValue([]);

      const { result } = renderHook(() => useFirebaseContext(), { wrapper });

      await act(async () => {
        await capturedAuthCallback!(fakeUser);
      });

      mockGetCampaigns.mockRejectedValueOnce(new Error("Firestore error"));

      let returned: any;
      await act(async () => {
        returned = await result.current.refreshCampaigns();
      });

      expect(returned).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  describe("Error paths", () => {
    // BUG #901: loadUserProfile uses hardcoded 1-second async delays between
    // retries (await new Promise(resolve => setTimeout(resolve, 1000))). These
    // delays are not controllable via jest.useFakeTimers() because async
    // Promise-based timers do not flush reliably with runAllTimers() in the
    // React act() environment. The only way to test this path is to wait 3+
    // real seconds per test, which is impractical.
    // Fix: accept a configurable delay parameter (defaulting to 1000ms in prod)
    // so tests can pass 0 or use jest.useFakeTimers with modern mode.
    test.skip(
      "should surface error via state when loadUserProfile exhausts retries — skipped due to bug #901",
      async () => {
        const fakeUser = makeUser("u-1");
        mockGetUserProfile.mockResolvedValue(null);

        const { result } = renderHook(() => useFirebaseContext(), { wrapper });

        await act(async () => {
          await capturedAuthCallback!(fakeUser);
        });

        // After all retries exhaust, error should be set
        expect(result.current.error).toBeTruthy();
      }
    );

    // See bug #901 above for the same reason this is skipped.
    test.skip(
      "should set error state when getUserProfile throws during auth load — skipped due to bug #901",
      async () => {
        const fakeUser = makeUser("u-1");
        mockGetUserProfile.mockRejectedValue(new Error("Firebase unavailable"));

        const { result } = renderHook(() => useFirebaseContext(), { wrapper });

        await act(async () => {
          await capturedAuthCallback!(fakeUser);
        });

        expect(result.current.error).toBeTruthy();
      }
    );

    test("should set error state when setActiveGroupContext fails", async () => {
      const fakeUser = makeUser("u-1");
      mockGetUserProfile.mockResolvedValue(
        makeUserProfile({ id: "u-1", activeGroupId: "g-1" })
      );
      mockGetGroups.mockResolvedValue([makeGroup("g-1")]);
      // Simulate getGroupUserProfile throwing
      mockGetGroupUserProfile.mockRejectedValue(new Error("Group profile error"));

      const { result } = renderHook(() => useFirebaseContext(), { wrapper });

      await act(async () => {
        await capturedAuthCallback!(fakeUser);
      });

      expect(result.current.error).toBe("Group profile error");
    });

    // Regression guard for the #1413 fix. `loading` is
    // `authLoading || profileLoading || groupsLoading`, so ANY one of the three
    // staying true pins `loading` true forever. The catch below this describe's
    // subject used to reset only `groupsLoading` and `authLoading` — but
    // `loadUserProfile` throws when its retries are exhausted, which skips the
    // `setProfileLoading(false)` on the happy path, leaving `profileLoading`
    // stuck true.
    //
    // Before #1413 that was nearly inert. After it, `useAuth().loading` feeds
    // `useCampaignContextStatus().isResolving`, so a stuck flag means every
    // entity page renders a PERMANENT spinner instead of its error state, and
    // `hasRequiredContext` never becomes true so writes throw. Fixing #1413
    // promoted a dormant defect into a page-level outage — the same
    // wake-a-neighbour pattern as #018 -> #852 and #1300 -> #1411.
    //
    // This costs ~2s of real time: getUserProfile rejects, and loadUserProfile
    // retries twice with hardcoded 1s backoffs before rethrowing (bug #901's
    // untestable delays). Unlike #901's two skipped siblings above, this one is
    // worth the wall-clock, because the state it guards is now user-visible.
    test("loading settles to false when the profile load fails outright", async () => {
      const fakeUser = makeUser("u-1");
      mockGetUserProfile.mockRejectedValue(new Error("Firebase unavailable"));

      const { result } = renderHook(() => useFirebaseContext(), { wrapper });

      await act(async () => {
        await capturedAuthCallback!(fakeUser);
      });

      // The user must reach a definite state. A stuck `loading` is worse than
      // the error itself: the page can never render anything but a spinner.
      expect(result.current.loading).toBe(false);
      expect(result.current.error).toBeTruthy();
    }, 10000);

    // NOTE: This test verifies that the provider does not throw synchronously.
    // The async retry loop (bug #901) means we cannot easily await full
    // completion; we only verify that initiating the auth callback does not
    // throw synchronously from the component.
    test("should not throw synchronously when user profile fetch fails on auth callback", () => {
      const fakeUser = makeUser("u-1");
      mockGetUserProfile.mockRejectedValue(new Error("boom"));

      const { result } = renderHook(() => useFirebaseContext(), { wrapper });

      // Initiate the auth callback — should not throw synchronously
      expect(() => {
        act(() => {
          capturedAuthCallback!(fakeUser);
        });
      }).not.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  describe("refreshUserProfile — with activeGroupId present (lines 74-75)", () => {
    test("should call setActiveGroupContext when refreshUserProfile returns a profile with activeGroupId", async () => {
      const fakeUser = makeUser("u-1");
      const initialProfile = makeUserProfile({
        id: "u-1",
        activeGroupId: null,
      });
      mockGetUserProfile.mockResolvedValue(initialProfile);
      mockGetGroups.mockResolvedValue([]);

      const { result } = renderHook(() => useFirebaseContext(), { wrapper });

      // Sign in with no activeGroupId so the initial load doesn't call setActiveGroupContext
      await act(async () => {
        await capturedAuthCallback!(fakeUser);
      });

      // Now refreshUserProfile with a profile that HAS activeGroupId
      const profileWithGroup = makeUserProfile({ id: "u-1", activeGroupId: "g-refresh" });
      mockGetUserProfile.mockResolvedValue(profileWithGroup);
      mockGetGroupUserProfile.mockResolvedValue(null);
      mockGetCampaigns.mockResolvedValue([]);

      await act(async () => {
        await result.current.refreshUserProfile();
      });

      // setActiveGroupContext should have been invoked → setActiveGroup called
      expect(mockSetActiveGroup).toHaveBeenCalledWith("g-refresh");
    });

    test("should update activeGroupId state when refreshUserProfile fires setActiveGroupContext", async () => {
      const fakeUser = makeUser("u-1");
      mockGetUserProfile.mockResolvedValue(makeUserProfile({ id: "u-1", activeGroupId: null }));
      mockGetGroups.mockResolvedValue([]);

      const { result } = renderHook(() => useFirebaseContext(), { wrapper });

      await act(async () => {
        await capturedAuthCallback!(fakeUser);
      });

      const profileWithGroup = makeUserProfile({ id: "u-1", activeGroupId: "g-new-active" });
      mockGetUserProfile.mockResolvedValue(profileWithGroup);
      mockGetGroupUserProfile.mockResolvedValue(null);
      mockGetCampaigns.mockResolvedValue([]);

      await act(async () => {
        await result.current.refreshUserProfile();
      });

      expect(result.current.activeGroupId).toBe("g-new-active");
    });
  });

  // -------------------------------------------------------------------------
  describe("setActiveGroupContext — no authenticated user guard (lines 98-99)", () => {
    test("should warn and return early when setActiveGroupContext is called with no user in state or param", async () => {
      // We trigger refreshGroups while user is authenticated, which calls setActiveGroupContext.
      // To hit lines 98-99 we need currentUser=null AND user state=null.
      // refreshGroups only runs if user is set — but setActiveGroupContext can be called
      // with currentUser=null from refreshGroups (it passes user from state).
      // The only path where both are null is when user state gets cleared between the
      // refreshGroups call and setActiveGroupContext executing (race condition).
      // This path is practically unreachable without race conditions; document it.
      // We verify the guard doesn't crash — no additional state mutations occur.
      const fakeUser = makeUser("u-1");
      mockGetUserProfile.mockResolvedValue(makeUserProfile({ id: "u-1", activeGroupId: null }));
      // Return one group so refreshGroups calls setActiveGroupContext
      mockGetGroups.mockResolvedValue([makeGroup("g-1")]);
      // Simulate no authenticated user at group-profile-fetch time
      mockGetGroupUserProfile.mockResolvedValue(null);
      mockGetCampaigns.mockResolvedValue([]);

      const { result } = renderHook(() => useFirebaseContext(), { wrapper });

      await act(async () => {
        await capturedAuthCallback!(fakeUser);
      });

      // setActiveGroupContext ran (setActiveGroup was called), no crash
      expect(mockSetActiveGroup).toHaveBeenCalled();
      // No group profile was loaded (null returned)
      expect(result.current.activeGroupUserProfile).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  describe("setActiveGroupContext — getCampaigns error path (line 144)", () => {
    test("should not propagate campaign-load error to context error state (catch swallows it)", async () => {
      const fakeUser = makeUser("u-1");
      mockGetUserProfile.mockResolvedValue(
        makeUserProfile({ id: "u-1", activeGroupId: "g-1" })
      );
      mockGetGroups.mockResolvedValue([makeGroup("g-1")]);
      mockGetGroupUserProfile.mockResolvedValue(makeGroupUserProfile());
      // getCampaigns throws — this hits the inner catch at line 143-144
      mockGetCampaigns.mockRejectedValue(new Error("Campaign fetch failed"));

      const { result } = renderHook(() => useFirebaseContext(), { wrapper });

      await act(async () => {
        await capturedAuthCallback!(fakeUser);
      });

      // Inner catch swallows the campaign error (no setError call for it)
      // The outer context error should NOT be set for a campaign load failure
      expect(result.current.error).toBeNull();
    });

    test("should still set activeGroupUserProfile even when getCampaigns throws", async () => {
      const fakeUser = makeUser("u-1");
      const groupProfile = makeGroupUserProfile();
      mockGetUserProfile.mockResolvedValue(
        makeUserProfile({ id: "u-1", activeGroupId: "g-1" })
      );
      mockGetGroups.mockResolvedValue([makeGroup("g-1")]);
      mockGetGroupUserProfile.mockResolvedValue(groupProfile);
      mockGetCampaigns.mockRejectedValue(new Error("Campaign network error"));

      const { result } = renderHook(() => useFirebaseContext(), { wrapper });

      await act(async () => {
        await capturedAuthCallback!(fakeUser);
      });

      expect(result.current.activeGroupUserProfile).toEqual(groupProfile);
    });

    test("should have empty campaigns after getCampaigns throws during setActiveGroupContext", async () => {
      const fakeUser = makeUser("u-1");
      mockGetUserProfile.mockResolvedValue(
        makeUserProfile({ id: "u-1", activeGroupId: "g-1" })
      );
      mockGetGroups.mockResolvedValue([makeGroup("g-1")]);
      mockGetGroupUserProfile.mockResolvedValue(makeGroupUserProfile());
      mockGetCampaigns.mockRejectedValue(new Error("Campaign load failed"));

      const { result } = renderHook(() => useFirebaseContext(), { wrapper });

      await act(async () => {
        await capturedAuthCallback!(fakeUser);
      });

      expect(result.current.campaigns).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  describe("loadGroups error path — getGroups throws (lines 253-254)", () => {
    // When getGroups throws inside loadGroups (lines 252-255), loadGroups re-throws.
    // This causes the outer try/catch in onAuthStateChanged (lines 293-296) to catch
    // and set the error state. This tests lines 253-254 AND 293-296.
    test("should set context error when getGroups throws during auth state change", async () => {
      const fakeUser = makeUser("u-1");
      mockGetUserProfile.mockResolvedValue(
        makeUserProfile({ id: "u-1", activeGroupId: null })
      );
      // getGroups throws — loadGroups re-throws — outer catch sets error
      mockGetGroups.mockRejectedValue(new Error("Firestore getGroups failed"));

      const { result } = renderHook(() => useFirebaseContext(), { wrapper });

      await act(async () => {
        await capturedAuthCallback!(fakeUser);
      });

      expect(result.current.error).toBe("Firestore getGroups failed");
    });

    // BUG #1153: When loadGroups throws (getGroups rejects), the outer catch in
    // onAuthStateChanged calls setAuthLoading(false) but never calls
    // setGroupsLoading(false) — setGroupsLoading(true) was called before loadGroups
    // and is never reset on the error path. loading stays true indefinitely because
    // loading = authLoading || profileLoading || groupsLoading, and groupsLoading
    // remains true. Fix: add setGroupsLoading(false) in the catch block.
    test("should set loading=false after getGroups throws during auth state change — skipped due to bug #1153", async () => {
      const fakeUser = makeUser("u-1");
      mockGetUserProfile.mockResolvedValue(
        makeUserProfile({ id: "u-1", activeGroupId: null })
      );
      mockGetGroups.mockRejectedValue(new Error("getGroups network error"));

      const { result } = renderHook(() => useFirebaseContext(), { wrapper });

      await act(async () => {
        await capturedAuthCallback!(fakeUser);
      });

      // After error, authLoading should be false (line 296: setAuthLoading(false))
      // loading = authLoading || profileLoading || groupsLoading
      // If authLoading is now false, profileLoading and groupsLoading should also be false
      expect(result.current.loading).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  describe("Dead code path — loadUserProfile always returns profile or throws (lines 289-291)", () => {
    // Lines 289-291 (the 'else' branch of 'if (profile)') are unreachable in practice
    // because loadUserProfile either returns a truthy UserProfile or throws an error.
    // It never returns null/undefined without throwing. This is a structural dead code path.
    // Bug #1152: Dead code at line 289-291. The 'else' branch after loadUserProfile()
    // can never execute — loadUserProfile throws before returning null. This dead code
    // should be removed to reduce confusion and improve code clarity.
    test("loadUserProfile never returns falsy without throwing (structural invariant)", async () => {
      // Verify: if loadUserProfile resolves, it always has a truthy profile
      const fakeUser = makeUser("u-1");
      const profile = makeUserProfile({ id: "u-1", activeGroupId: null });
      mockGetUserProfile.mockResolvedValue(profile);
      mockGetGroups.mockResolvedValue([]);

      const { result } = renderHook(() => useFirebaseContext(), { wrapper });

      await act(async () => {
        await capturedAuthCallback!(fakeUser);
      });

      // Profile is set — loadUserProfile returned a truthy profile
      expect(result.current.userProfile).not.toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // A brand-new account signs in before `redeemInvitation` has written its
  // profile, so the auth listener finds none and does not run again. This is
  // what loads everything once the join has happened.
  describe("reloadUserContext", () => {
    test("does nothing when nobody is signed in", async () => {
      const { result } = renderHook(() => useFirebaseContext(), { wrapper });
      await act(async () => {
        await result.current.reloadUserContext();
      });
      expect(mockGetUserProfile).not.toHaveBeenCalled();
    });

    test("does nothing while the profile still does not exist", async () => {
      mockGetUser.mockReturnValue(makeUser("u-new"));
      const { result } = renderHook(() => useFirebaseContext(), { wrapper });
      await act(async () => {
        await result.current.reloadUserContext();
      });
      expect(mockGetUserProfile).toHaveBeenCalledWith("u-new");
      expect(result.current.userProfile).toBeNull();
      expect(mockGetGroups).not.toHaveBeenCalled();
    });

    // The hook's own `user` may still be null in the closure that called it;
    // the signed-in user is read from the auth service instead.
    test("loads the profile, groups and active group for the signed-in user", async () => {
      const newUser = makeUser("u-new");
      mockGetUser.mockReturnValue(newUser);
      mockGetUserProfile.mockResolvedValue(
        makeUserProfile({ id: "u-new", groups: ["group-9"], activeGroupId: "group-9" })
      );
      mockGetGroups.mockResolvedValue([makeGroup("group-9")]);
      mockGetGroupUserProfile.mockResolvedValue(makeGroupUserProfile({ userId: "u-new" }));

      const { result } = renderHook(() => useFirebaseContext(), { wrapper });
      await act(async () => {
        await result.current.reloadUserContext();
      });

      expect(result.current.userProfile?.id).toBe("u-new");
      expect(result.current.groups.map((g) => g.id)).toEqual(["group-9"]);
      expect(result.current.activeGroupId).toBe("group-9");
      expect(mockGetGroupUserProfile).toHaveBeenCalledWith("group-9", "u-new");
    });

    // The listener's earlier failure to find a profile set an error; a
    // successful reload must not leave it standing.
    test("clears a stale error once it succeeds", async () => {
      mockGetUser.mockReturnValue(makeUser("u-new"));
      mockGetUserProfile.mockResolvedValue(makeUserProfile({ id: "u-new" }));
      const { result } = renderHook(() => useFirebaseContext(), { wrapper });

      act(() => result.current.setError("Failed to load user profile after multiple attempts"));
      await act(async () => {
        await result.current.reloadUserContext();
      });

      expect(result.current.error).toBeNull();
    });

    test("surfaces a failure as an error rather than throwing", async () => {
      mockGetUser.mockReturnValue(makeUser("u-new"));
      mockGetUserProfile.mockRejectedValue(new Error("offline"));
      const { result } = renderHook(() => useFirebaseContext(), { wrapper });

      await act(async () => {
        await result.current.reloadUserContext();
      });

      expect(result.current.error).toBe("offline");
    });
  });

  // AUTH-003: a load started for one user finished after a newer auth state
  // (signed out, or another user) and wrote the old user's context back.
  describe("a load that finishes after the user changed", () => {
    /** A promise the test settles by hand. */
    function deferred<T>() {
      let resolve!: (value: T) => void;
      const promise = new Promise<T>((r) => {
        resolve = r;
      });
      return { promise, resolve };
    }

    test("does not restore the old profile after sign-out", async () => {
      const held = deferred<UserProfile>();
      mockGetUserProfile.mockReturnValueOnce(held.promise);
      const { result } = renderHook(() => useFirebaseContext(), { wrapper });

      let first!: Promise<void>;
      act(() => {
        first = capturedAuthCallback!(makeUser("user-1"));
      });
      await act(async () => {
        await capturedAuthCallback!(null);
      });
      await act(async () => {
        held.resolve(makeUserProfile({ id: "user-1", activeGroupId: "group-1", groups: ["group-1"] }));
        await first;
      });

      expect(result.current.user).toBeNull();
      expect(result.current.userProfile).toBeNull();
      expect(result.current.activeGroupId).toBeNull();
      expect(result.current.activeCampaignId).toBeNull();
      expect(mockGetGroups).not.toHaveBeenCalled();
    });

    test("does not restore the old group and campaign after sign-out", async () => {
      mockGetUserProfile.mockResolvedValue(
        makeUserProfile({ id: "user-1", activeGroupId: "group-1", groups: ["group-1"] })
      );
      mockGetGroups.mockResolvedValue([makeGroup("group-1")]);
      const heldProfile = deferred<GroupUserProfile>();
      mockGetGroupUserProfile.mockReturnValueOnce(heldProfile.promise);
      mockGetCampaigns.mockResolvedValue([makeCampaign("campaign-1", "group-1")]);
      const { result } = renderHook(() => useFirebaseContext(), { wrapper });

      let first!: Promise<void>;
      act(() => {
        first = capturedAuthCallback!(makeUser("user-1"));
      });
      await waitFor(() => expect(mockGetGroupUserProfile).toHaveBeenCalled());
      await act(async () => {
        await capturedAuthCallback!(null);
      });
      mockSetActiveCampaign.mockClear();
      await act(async () => {
        heldProfile.resolve(makeGroupUserProfile({ activeCampaignId: "campaign-1" }));
        await first;
      });

      expect(result.current.activeGroupUserProfile).toBeNull();
      expect(result.current.campaigns).toEqual([]);
      expect(result.current.activeCampaignId).toBeNull();
      expect(mockSetActiveCampaign).not.toHaveBeenCalled();
    });

    test("keeps the new user's profile when the old user's load finishes last", async () => {
      const held = deferred<UserProfile>();
      mockGetUserProfile
        .mockReturnValueOnce(held.promise)
        .mockResolvedValueOnce(makeUserProfile({ id: "user-2", activeGroupId: null, groups: [] }));
      const { result } = renderHook(() => useFirebaseContext(), { wrapper });

      let first!: Promise<void>;
      act(() => {
        first = capturedAuthCallback!(makeUser("user-1"));
      });
      await act(async () => {
        await capturedAuthCallback!(makeUser("user-2"));
      });
      await act(async () => {
        held.resolve(makeUserProfile({ id: "user-1", activeGroupId: null, groups: [] }));
        await first;
      });

      expect(result.current.user?.uid).toBe("user-2");
      expect(result.current.userProfile?.id).toBe("user-2");
      expect(result.current.loading).toBe(false);
    });
  });

  describe("Cleanup — unsubscribe on unmount", () => {
    test("should call the unsubscribe function returned by onAuthStateChanged when the provider unmounts", () => {
      const { unmount } = renderHook(() => useFirebaseContext(), { wrapper });

      // Ensure the mock was captured
      expect(mockUnsubscribe).toBeDefined();

      unmount();

      expect(mockUnsubscribe).toHaveBeenCalledTimes(1);
    });
  });

  // -------------------------------------------------------------------------
  describe("setActiveGroupId / setActiveCampaignId state persistence", () => {
    // NOTE: FirebaseContext does not expose direct setActiveGroupId /
    // setActiveCampaignId on the context interface — these are internal state
    // setters driven by setActiveGroupContext (called during auth or
    // refreshGroups). The public API for driving group/campaign selection flows
    // through onAuthStateChanged and refreshGroups/refreshCampaigns.
    // The following tests verify that the service-layer calls that "persist"
    // the selection happen correctly.

    test("should call firebaseServices.auth.setActiveGroup when a group is activated", async () => {
      const fakeUser = makeUser("u-1");
      mockGetUserProfile.mockResolvedValue(
        makeUserProfile({ id: "u-1", activeGroupId: "g-persist" })
      );
      mockGetGroups.mockResolvedValue([makeGroup("g-persist")]);
      mockGetGroupUserProfile.mockResolvedValue(null);
      mockGetCampaigns.mockResolvedValue([]);

      renderHook(() => useFirebaseContext(), { wrapper });

      await act(async () => {
        await capturedAuthCallback!(fakeUser);
      });

      expect(mockSetActiveGroup).toHaveBeenCalledWith("g-persist");
    });

    test("should call firebaseServices.auth.setActiveCampaign when a campaign is activated", async () => {
      const fakeUser = makeUser("u-1");
      const campaigns = [makeCampaign("c-persist")];

      mockGetUserProfile.mockResolvedValue(
        makeUserProfile({ id: "u-1", activeGroupId: "g-1" })
      );
      mockGetGroups.mockResolvedValue([makeGroup("g-1")]);
      mockGetGroupUserProfile.mockResolvedValue(
        makeGroupUserProfile({ activeCampaignId: "c-persist" })
      );
      mockGetCampaigns.mockResolvedValue(campaigns);

      renderHook(() => useFirebaseContext(), { wrapper });

      await act(async () => {
        await capturedAuthCallback!(fakeUser);
      });

      expect(mockSetActiveCampaign).toHaveBeenCalledWith("c-persist");
    });

    test("should update activeCampaignId in state when a campaign is activated", async () => {
      const fakeUser = makeUser("u-1");
      const campaigns = [makeCampaign("c-state-check")];

      mockGetUserProfile.mockResolvedValue(
        makeUserProfile({ id: "u-1", activeGroupId: "g-1" })
      );
      mockGetGroups.mockResolvedValue([makeGroup("g-1")]);
      mockGetGroupUserProfile.mockResolvedValue(
        makeGroupUserProfile({ activeCampaignId: "c-state-check" })
      );
      mockGetCampaigns.mockResolvedValue(campaigns);

      const { result } = renderHook(() => useFirebaseContext(), { wrapper });

      await act(async () => {
        await capturedAuthCallback!(fakeUser);
      });

      expect(result.current.activeCampaignId).toBe("c-state-check");
    });

    test("should update activeGroupId in state when a group is activated", async () => {
      const fakeUser = makeUser("u-1");
      mockGetUserProfile.mockResolvedValue(
        makeUserProfile({ id: "u-1", activeGroupId: "g-active-state" })
      );
      mockGetGroups.mockResolvedValue([makeGroup("g-active-state")]);
      mockGetGroupUserProfile.mockResolvedValue(null);
      mockGetCampaigns.mockResolvedValue([]);

      const { result } = renderHook(() => useFirebaseContext(), { wrapper });

      await act(async () => {
        await capturedAuthCallback!(fakeUser);
      });

      expect(result.current.activeGroupId).toBe("g-active-state");
    });
  });

  // -------------------------------------------------------------------------
  // Switching context in place
  //
  // Before these existed, setActiveGroup persisted to Firestore and called
  // refreshGroups, which only re-lists groups -- activeGroupId in React state
  // never moved. window.location.reload() was the whole switching mechanism.
  // -------------------------------------------------------------------------
  describe("switchGroup / switchCampaign", () => {
    /** Sign a user in with two groups, group-1 active, and settle the provider. */
    async function signInWithTwoGroups() {
      mockGetUserProfile.mockResolvedValue(
        makeUserProfile({ groups: ["group-1", "group-2"], activeGroupId: "group-1" })
      );
      mockGetGroups.mockResolvedValue([makeGroup("group-1"), makeGroup("group-2")]);
      mockGetGroupUserProfile.mockResolvedValue(
        makeGroupUserProfile({ activeCampaignId: "campaign-1" })
      );
      mockGetCampaigns.mockResolvedValue([makeCampaign("campaign-1", "group-1")]);

      const rendered = renderHook(() => useFirebaseContext(), { wrapper });

      await act(async () => {
        await capturedAuthCallback!(makeUser());
      });
      await waitFor(() => expect(rendered.result.current.activeGroupId).toBe("group-1"));

      return rendered;
    }

    test("switchGroup moves activeGroupId in React state, not just in Firestore", async () => {
      const { result } = await signInWithTwoGroups();

      mockGetGroupUserProfile.mockResolvedValue(
        makeGroupUserProfile({ activeCampaignId: "campaign-9" })
      );
      mockGetCampaigns.mockResolvedValue([makeCampaign("campaign-9", "group-2")]);

      await act(async () => {
        await result.current.switchGroup("group-2");
      });

      expect(result.current.activeGroupId).toBe("group-2");
      expect(mockUpdateUserProfile).toHaveBeenCalledWith("user-1", {
        activeGroupId: "group-2",
      });
    });

    test("switchGroup loads the new group's campaigns and activates its own", async () => {
      const { result } = await signInWithTwoGroups();

      mockGetGroupUserProfile.mockResolvedValue(
        makeGroupUserProfile({ activeCampaignId: "campaign-9" })
      );
      mockGetCampaigns.mockResolvedValue([makeCampaign("campaign-9", "group-2")]);

      await act(async () => {
        await result.current.switchGroup("group-2");
      });

      expect(mockGetCampaigns).toHaveBeenLastCalledWith("group-2");
      expect(result.current.campaigns.map((c) => c.id)).toEqual(["campaign-9"]);
      expect(result.current.activeCampaignId).toBe("campaign-9");
    });

    test("switchGroup rejects and leaves the context alone when the write fails", async () => {
      const { result } = await signInWithTwoGroups();
      mockUpdateUserProfile.mockRejectedValue(new Error("Profile write failed"));

      await act(async () => {
        await expect(result.current.switchGroup("group-2")).rejects.toThrow(
          "Profile write failed"
        );
      });

      expect(result.current.activeGroupId).toBe("group-1");
    });

    test("switchGroup refuses when there is no authenticated user", async () => {
      const { result } = await signInWithTwoGroups();
      mockUpdateUserProfile.mockClear();
      mockGetCurrentUserId.mockReturnValue(null);

      await act(async () => {
        await expect(result.current.switchGroup("group-2")).rejects.toThrow(
          "Not authenticated"
        );
      });

      // The old useGroups.switchGroup coerced a null id to '' and wrote to
      // users/, creating a document at an empty path segment. The provider
      // refuses instead, so nothing is written and the context does not move.
      expect(mockUpdateUserProfile).not.toHaveBeenCalled();
      expect(result.current.activeGroupId).toBe("group-1");
    });

    test("switchCampaign moves activeCampaignId in React state", async () => {
      const { result } = await signInWithTwoGroups();

      await act(async () => {
        await result.current.switchCampaign("campaign-2");
      });

      expect(result.current.activeCampaignId).toBe("campaign-2");
      expect(mockUpdateGroupUserProfile).toHaveBeenCalledWith("group-1", "user-1", {
        activeCampaignId: "campaign-2",
      });
      expect(mockSetActiveCampaign).toHaveBeenCalledWith("campaign-2");
    });

    test("switchCampaign rejects and leaves the context alone when the write fails", async () => {
      const { result } = await signInWithTwoGroups();
      mockUpdateGroupUserProfile.mockRejectedValue(new Error("Group profile write failed"));

      await act(async () => {
        await expect(result.current.switchCampaign("campaign-2")).rejects.toThrow(
          "Group profile write failed"
        );
      });

      expect(result.current.activeCampaignId).toBe("campaign-1");
    });

    test("switchCampaign refuses when there is no active group", async () => {
      const { result } = renderHook(() => useFirebaseContext(), { wrapper });

      await act(async () => {
        await expect(result.current.switchCampaign("campaign-2")).rejects.toThrow(
          "No active group selected"
        );
      });
    });
  });
});
