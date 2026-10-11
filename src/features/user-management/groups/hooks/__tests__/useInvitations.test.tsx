// src/context/firebase/hooks/__tests__/useInvitations.test.tsx

import { renderHook, act } from "@testing-library/react";
import { useInvitations } from "../useInvitations";

/**
 * useInvitations Behavioral Testing
 *
 * Tests the useInvitations hook against a mocked useFirebaseContext and
 * firebaseServices. Validates:
 * - Returned API shape
 * - Success paths: each function forwards correct arguments
 * - Error paths: errors surface via setError (and sometimes re-thrown, sometimes swallowed)
 * - Guard checks: generateRegistrationToken requires activeGroupId + admin role
 * - getRegistrationTokens and deleteRegistrationToken require activeGroupId
 * - Memoization: callbacks stable across re-renders
 */

// ---------------------------------------------------------------------------
// Mock firebaseServices
// ---------------------------------------------------------------------------
const mockGenerateGroupRegistrationToken = jest.fn();
const mockValidateRegistrationToken = jest.fn();
const mockReserveSignUp = jest.fn();
const mockJoinGroupWithToken = jest.fn();
const mockGetGroupRegistrationTokens = jest.fn();
const mockDeleteGroupRegistrationToken = jest.fn();
const mockRevealGroupRegistrationToken = jest.fn();

jest.mock("@/core/services/firebase", () => ({
  __esModule: true,
  default: {
    invitation: {
      generateGroupRegistrationToken: (...args: any[]) =>
        mockGenerateGroupRegistrationToken(...args),
      validateRegistrationToken: (...args: any[]) =>
        mockValidateRegistrationToken(...args),
      reserveSignUp: (...args: any[]) => mockReserveSignUp(...args),
      joinGroupWithToken: (...args: any[]) => mockJoinGroupWithToken(...args),
      getGroupRegistrationTokens: (...args: any[]) =>
        mockGetGroupRegistrationTokens(...args),
      deleteGroupRegistrationToken: (...args: any[]) =>
        mockDeleteGroupRegistrationToken(...args),
      revealGroupRegistrationToken: (...args: any[]) =>
        mockRevealGroupRegistrationToken(...args),
    },
  },
}));

// ---------------------------------------------------------------------------
// Mock useFirebaseContext
// ---------------------------------------------------------------------------
const mockSetError = jest.fn();
const mockRefreshGroups = jest.fn();

let mockContextValue: any = {};

jest.mock("@/features/user-management/auth/context/FirebaseContext", () => ({
  useFirebaseContext: () => mockContextValue,
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeContext(overrides: Record<string, any> = {}) {
  return {
    user: null,
    userProfile: null,
    loading: false,
    error: null,
    setError: mockSetError,
    groups: [],
    activeGroupId: null,
    activeGroupUserProfile: null,
    campaigns: [],
    activeCampaignId: null,
    refreshGroups: mockRefreshGroups,
    refreshCampaigns: jest.fn().mockResolvedValue([]),
    refreshUserProfile: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function makeAdminProfile() {
  return { role: "admin", username: "alice" } as any;
}

function makeMemberProfile() {
  return { role: "member", username: "bob" } as any;
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------
describe("useInvitations Behavioral Testing", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRefreshGroups.mockResolvedValue([]);
    mockContextValue = makeContext();
  });

  // -------------------------------------------------------------------------
  describe("Initialization / Shape", () => {
    test("should expose all required API members", () => {
      const { result } = renderHook(() => useInvitations());

      expect(typeof result.current.generateRegistrationToken).toBe("function");
      expect(typeof result.current.validateToken).toBe("function");
      expect(typeof result.current.reserveSignUp).toBe("function");
      expect(typeof result.current.joinGroupWithToken).toBe("function");
      expect(typeof result.current.getRegistrationTokens).toBe("function");
      expect(typeof result.current.deleteRegistrationToken).toBe("function");
    });
  });

  // -------------------------------------------------------------------------
  describe("generateRegistrationToken Behavior", () => {
    test("should throw when no activeGroupId is set", async () => {
      mockContextValue = makeContext({
        activeGroupId: null,
        activeGroupUserProfile: makeAdminProfile(),
      });

      const { result } = renderHook(() => useInvitations());

      await expect(
        act(async () => {
          await result.current.generateRegistrationToken();
        })
      ).rejects.toThrow("No active group selected");
    });

    test("should throw when user is not admin (null profile)", async () => {
      mockContextValue = makeContext({
        activeGroupId: "g1",
        activeGroupUserProfile: null,
      });

      const { result } = renderHook(() => useInvitations());

      await expect(
        act(async () => {
          await result.current.generateRegistrationToken();
        })
      ).rejects.toThrow("Only admins can generate registration tokens");
    });

    test("should throw when user is a member (not admin)", async () => {
      mockContextValue = makeContext({
        activeGroupId: "g1",
        activeGroupUserProfile: makeMemberProfile(),
      });

      const { result } = renderHook(() => useInvitations());

      await expect(
        act(async () => {
          await result.current.generateRegistrationToken();
        })
      ).rejects.toThrow("Only admins can generate registration tokens");
    });

    // Regression test for bug #702: the admin check used to be case-sensitive
    // (`role !== 'admin'`), disagreeing with useGroups.isAdmin's
    // `role?.toLowerCase() === 'admin'`. A user with role 'Admin' was incorrectly
    // rejected here even though useGroups considered them an admin.
    test("should allow a mixed-case admin role, matching useGroups.isAdmin", async () => {
      mockGenerateGroupRegistrationToken.mockResolvedValue("token-abc");
      mockContextValue = makeContext({
        activeGroupId: "g1",
        activeGroupUserProfile: { role: "Admin", username: "alice" },
      });

      const { result } = renderHook(() => useInvitations());

      await act(async () => {
        await result.current.generateRegistrationToken();
      });

      expect(mockGenerateGroupRegistrationToken).toHaveBeenCalledWith("g1", "");
    });

    test("should call invitation.generateGroupRegistrationToken with groupId and notes", async () => {
      mockGenerateGroupRegistrationToken.mockResolvedValue("token-abc");
      mockContextValue = makeContext({
        activeGroupId: "g1",
        activeGroupUserProfile: makeAdminProfile(),
      });

      const { result } = renderHook(() => useInvitations());

      await act(async () => {
        await result.current.generateRegistrationToken("some notes");
      });

      expect(mockGenerateGroupRegistrationToken).toHaveBeenCalledWith("g1", "some notes");
    });

    test("should use empty string as default notes", async () => {
      mockGenerateGroupRegistrationToken.mockResolvedValue("token-abc");
      mockContextValue = makeContext({
        activeGroupId: "g1",
        activeGroupUserProfile: makeAdminProfile(),
      });

      const { result } = renderHook(() => useInvitations());

      await act(async () => {
        await result.current.generateRegistrationToken();
      });

      expect(mockGenerateGroupRegistrationToken).toHaveBeenCalledWith("g1", "");
    });

    test("should return the generated token", async () => {
      mockGenerateGroupRegistrationToken.mockResolvedValue("token-xyz");
      mockContextValue = makeContext({
        activeGroupId: "g1",
        activeGroupUserProfile: makeAdminProfile(),
      });

      const { result } = renderHook(() => useInvitations());

      let token: string | undefined;
      await act(async () => {
        token = await result.current.generateRegistrationToken();
      });

      expect(token).toBe("token-xyz");
    });

    test("should call setError and re-throw on failure", async () => {
      mockGenerateGroupRegistrationToken.mockRejectedValue(new Error("Token gen failed"));
      mockContextValue = makeContext({
        activeGroupId: "g1",
        activeGroupUserProfile: makeAdminProfile(),
      });

      const { result } = renderHook(() => useInvitations());

      await act(async () => {
        try {
          await result.current.generateRegistrationToken();
        } catch (_) {}
      });

      expect(mockSetError).toHaveBeenCalledWith("Token gen failed");
    });
  });

  // -------------------------------------------------------------------------
  describe("validateToken Behavior", () => {
    test("should call invitation.validateRegistrationToken with the token", async () => {
      mockValidateRegistrationToken.mockResolvedValue({ isValid: true });

      const { result } = renderHook(() => useInvitations());

      await act(async () => {
        await result.current.validateToken("tok123");
      });

      expect(mockValidateRegistrationToken).toHaveBeenCalledWith("tok123");
    });

    test("should return true when token is valid", async () => {
      mockValidateRegistrationToken.mockResolvedValue({ isValid: true });

      const { result } = renderHook(() => useInvitations());

      let res: boolean | undefined;
      await act(async () => {
        res = await result.current.validateToken("tok123");
      });

      expect(res).toBe(true);
    });

    test("should return false when token is invalid", async () => {
      mockValidateRegistrationToken.mockResolvedValue({ isValid: false });

      const { result } = renderHook(() => useInvitations());

      let res: boolean | undefined;
      await act(async () => {
        res = await result.current.validateToken("bad-tok");
      });

      expect(res).toBe(false);
    });

    test("should call setError and return false on failure (error swallowed)", async () => {
      mockValidateRegistrationToken.mockRejectedValue(new Error("Validation error"));

      const { result } = renderHook(() => useInvitations());

      let res: boolean | undefined;
      await act(async () => {
        res = await result.current.validateToken("tok");
      });

      // BEHAVIOR: error swallowed — returns false, does not re-throw
      expect(res).toBe(false);
      expect(mockSetError).toHaveBeenCalledWith("Validation error");
    });
  });

  // -------------------------------------------------------------------------
  // Replaces the suite for the removed password sign-up (T022). An account is
  // now created by signing in, and only for an address an invitation
  // reserved first -- which is this call.
  describe("reserveSignUp Behavior", () => {
    test("should call invitation.reserveSignUp with correct args", async () => {
      mockReserveSignUp.mockResolvedValue(undefined);

      const { result } = renderHook(() => useInvitations());

      await act(async () => {
        await result.current.reserveSignUp("tok", "user@test.com");
      });

      expect(mockReserveSignUp).toHaveBeenCalledWith("tok", "user@test.com");
    });

    test("should not refresh groups -- nobody has joined anything yet", async () => {
      mockReserveSignUp.mockResolvedValue(undefined);

      const { result } = renderHook(() => useInvitations());

      await act(async () => {
        await result.current.reserveSignUp("tok", "u@t.com");
      });

      expect(mockRefreshGroups).not.toHaveBeenCalled();
    });

    test("should call setError and re-throw on failure", async () => {
      mockReserveSignUp.mockRejectedValue(new Error("This invitation has expired."));

      const { result } = renderHook(() => useInvitations());

      let caught: unknown;
      await act(async () => {
        try {
          await result.current.reserveSignUp("tok", "u@t.com");
        } catch (err) {
          caught = err;
        }
      });

      expect(mockSetError).toHaveBeenCalledWith("This invitation has expired.");
      expect(caught).toBeInstanceOf(Error);
    });
  });

  // -------------------------------------------------------------------------
  describe("joinGroupWithToken Behavior", () => {
    test("should call invitation.joinGroupWithToken with correct args", async () => {
      mockJoinGroupWithToken.mockResolvedValue(undefined);

      const { result } = renderHook(() => useInvitations());

      await act(async () => {
        await result.current.joinGroupWithToken("tok", "alice");
      });

      expect(mockJoinGroupWithToken).toHaveBeenCalledWith("tok", "alice");
    });

    test("should call refreshGroups after joining", async () => {
      mockJoinGroupWithToken.mockResolvedValue(undefined);

      const { result } = renderHook(() => useInvitations());

      await act(async () => {
        await result.current.joinGroupWithToken("tok", "bob");
      });

      expect(mockRefreshGroups).toHaveBeenCalledTimes(1);
    });

    test("should call setError and re-throw on failure", async () => {
      mockJoinGroupWithToken.mockRejectedValue(new Error("Join failed"));

      const { result } = renderHook(() => useInvitations());

      await act(async () => {
        try {
          await result.current.joinGroupWithToken("tok", "alice");
        } catch (_) {}
      });

      expect(mockSetError).toHaveBeenCalledWith("Join failed");
    });
  });

  // -------------------------------------------------------------------------
  describe("getRegistrationTokens Behavior", () => {
    test("should throw when no activeGroupId is set", async () => {
      mockContextValue = makeContext({ activeGroupId: null });

      const { result } = renderHook(() => useInvitations());

      await expect(
        act(async () => {
          await result.current.getRegistrationTokens();
        })
      ).rejects.toThrow("No active group selected");
    });

    test("should call invitation.getGroupRegistrationTokens with activeGroupId", async () => {
      const tokens = [{ token: "t1" }, { token: "t2" }];
      mockGetGroupRegistrationTokens.mockResolvedValue(tokens);
      mockContextValue = makeContext({ activeGroupId: "g1" });

      const { result } = renderHook(() => useInvitations());

      let res: any;
      await act(async () => {
        res = await result.current.getRegistrationTokens();
      });

      expect(mockGetGroupRegistrationTokens).toHaveBeenCalledWith("g1");
      expect(res).toEqual(tokens);
    });

    test("should call setError and re-throw on failure", async () => {
      mockGetGroupRegistrationTokens.mockRejectedValue(new Error("Fetch tokens failed"));
      mockContextValue = makeContext({ activeGroupId: "g1" });

      const { result } = renderHook(() => useInvitations());

      await act(async () => {
        try {
          await result.current.getRegistrationTokens();
        } catch (_) {}
      });

      expect(mockSetError).toHaveBeenCalledWith("Fetch tokens failed");
    });
  });

  // -------------------------------------------------------------------------
  describe("deleteRegistrationToken Behavior", () => {
    test("should throw when no activeGroupId is set", async () => {
      mockContextValue = makeContext({ activeGroupId: null });

      const { result } = renderHook(() => useInvitations());

      await expect(
        act(async () => {
          await result.current.deleteRegistrationToken("tok1");
        })
      ).rejects.toThrow("No active group selected");
    });

    test("should call invitation.deleteGroupRegistrationToken with correct args", async () => {
      mockDeleteGroupRegistrationToken.mockResolvedValue(undefined);
      mockContextValue = makeContext({ activeGroupId: "g1" });

      const { result } = renderHook(() => useInvitations());

      await act(async () => {
        await result.current.deleteRegistrationToken("tok1");
      });

      expect(mockDeleteGroupRegistrationToken).toHaveBeenCalledWith("g1", "tok1");
    });

    test("should call setError and re-throw on failure", async () => {
      mockDeleteGroupRegistrationToken.mockRejectedValue(new Error("Delete token failed"));
      mockContextValue = makeContext({ activeGroupId: "g1" });

      const { result } = renderHook(() => useInvitations());

      await act(async () => {
        try {
          await result.current.deleteRegistrationToken("tok1");
        } catch (_) {}
      });

      expect(mockSetError).toHaveBeenCalledWith("Delete token failed");
    });
  });

  // -------------------------------------------------------------------------
  // T145: an invitation's id is its token's hash, so a link to copy again
  // needs the token from the server.
  describe("revealRegistrationToken Behavior", () => {
    test("should throw when no activeGroupId is set", async () => {
      mockContextValue = makeContext({ activeGroupId: null });
      const { result } = renderHook(() => useInvitations());

      await expect(
        act(async () => {
          await result.current.revealRegistrationToken("hash-id");
        })
      ).rejects.toThrow("No active group selected");
      expect(mockRevealGroupRegistrationToken).not.toHaveBeenCalled();
    });

    test("should return the token the service reveals for the active group", async () => {
      mockRevealGroupRegistrationToken.mockResolvedValue("the-token");
      mockContextValue = makeContext({ activeGroupId: "g1" });
      const { result } = renderHook(() => useInvitations());

      let token = "";
      await act(async () => {
        token = await result.current.revealRegistrationToken("hash-id");
      });

      expect(token).toBe("the-token");
      expect(mockRevealGroupRegistrationToken).toHaveBeenCalledWith("g1", "hash-id");
    });

    test("should call setError and re-throw on failure", async () => {
      mockRevealGroupRegistrationToken.mockRejectedValue(new Error("This invitation has been used."));
      mockContextValue = makeContext({ activeGroupId: "g1" });
      const { result } = renderHook(() => useInvitations());

      await act(async () => {
        try {
          await result.current.revealRegistrationToken("hash-id");
        } catch (_) {}
      });

      expect(mockSetError).toHaveBeenCalledWith("This invitation has been used.");
    });
  });

  // -------------------------------------------------------------------------
  describe("Memoization Behavior", () => {
    test("generateRegistrationToken reference should be stable across re-renders", () => {
      const { result, rerender } = renderHook(() => useInvitations());

      const firstRef = result.current.generateRegistrationToken;
      rerender();

      expect(result.current.generateRegistrationToken).toBe(firstRef);
    });

    test("validateToken reference should be stable across re-renders", () => {
      const { result, rerender } = renderHook(() => useInvitations());

      const firstRef = result.current.validateToken;
      rerender();

      expect(result.current.validateToken).toBe(firstRef);
    });

    test("reserveSignUp reference should be stable across re-renders", () => {
      const { result, rerender } = renderHook(() => useInvitations());

      const firstRef = result.current.reserveSignUp;
      rerender();

      expect(result.current.reserveSignUp).toBe(firstRef);
    });
  });
});
