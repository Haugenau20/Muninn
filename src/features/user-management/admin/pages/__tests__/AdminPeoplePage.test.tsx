// src/features/user-management/admin/pages/__tests__/AdminPeoplePage.test.tsx
import React from "react";
import { render, screen, within, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import AdminPeoplePage from "../AdminPeoplePage";
import type { AdminOutletContext } from "../admin-outlet";
import type { GroupMember, RegistrationToken } from "../../types";

jest.mock("@/features/user-management/groups/hooks/useGroups", () => ({
  useGroups: jest.fn(),
}));

jest.mock("@/features/user-management/groups/hooks/useInvitations", () => ({
  useInvitations: jest.fn(),
}));

const { useGroups } = require("@/features/user-management/groups/hooks/useGroups");
const {
  useInvitations,
} = require("@/features/user-management/groups/hooks/useInvitations");

// Shaped as Firestore actually returns them: the document id **is** the uid,
// and no `userId` field exists on the document. Measured against the emulator,
// not assumed -- `GroupService.getGroupUsers` spreads the data, then sets `id`
// (and `userId`) to `doc.id`; none of the five group-user documents carries a
// `userId` of its own.
const MEMBERS: GroupMember[] = [
  { id: "u1", username: "Legolas", role: "admin", joinedAt: new Date("2025-05-31") },
  { id: "u2", username: "DungeonMaster", role: "Admin", joinedAt: new Date("2025-05-31") },
  { id: "u3", username: "Aragorn", role: "member", joinedAt: new Date("2025-05-31") },
  { id: "u4", username: "Gimli", role: "member", joinedAt: new Date("2025-05-31") },
];

const TOKENS: RegistrationToken[] = [
  { id: "spare-1", notes: "Spare invitation", used: false, createdAt: new Date("2025-05-31") },
  { id: "used-1", notes: "Aragorn", used: true, usedBy: "u3", createdAt: new Date("2025-05-30") },
  { id: "used-2", used: true, usedBy: "u4", createdAt: new Date("2025-05-30") },
];

const deleteUser = jest.fn().mockResolvedValue(undefined);
const setMemberRole = jest.fn().mockResolvedValue(undefined);
const generateRegistrationToken = jest.fn().mockResolvedValue("fresh-token");
const deleteRegistrationToken = jest.fn().mockResolvedValue(undefined);
const updateRegistrationTokenNotes = jest.fn().mockResolvedValue(undefined);
// The token behind an invitation id comes from the server (T145).
let revealRegistrationToken = jest.fn();
let getRegistrationTokens = jest.fn();

function setup({ members = MEMBERS, tokens = TOKENS, membersLoading = false } = {}) {
  getRegistrationTokens = jest.fn().mockResolvedValue(tokens);
  revealRegistrationToken = jest.fn().mockResolvedValue("revealed-token");
  useGroups.mockReturnValue({
    user: { uid: "u1" },
    activeGroup: { id: "g1", name: "The Fellowship" },
    activeGroupId: "g1",
    deleteUser,
    setMemberRole,
  });
  useInvitations.mockReturnValue({
    generateRegistrationToken,
    getRegistrationTokens,
    revealRegistrationToken,
    deleteRegistrationToken,
    updateRegistrationTokenNotes,
  });

  const context: AdminOutletContext = {
    members,
    membersLoading,
    membersError: null,
    reloadMembers: jest.fn().mockResolvedValue(undefined),
  };

  return render(
    <MemoryRouter initialEntries={["/admin/people"]}>
      <Routes>
        <Route path="/admin" element={<OutletHost context={context} />}>
          <Route path="/admin/people" element={<AdminPeoplePage />} />
        </Route>
      </Routes>
    </MemoryRouter>
  );
}

const OutletHost: React.FC<{ context: AdminOutletContext }> = ({ context }) => {
  const { Outlet } = require("react-router-dom");
  return <Outlet context={context} />;
};

async function settle() {
  await act(async () => {
    await Promise.resolve();
  });
}

function membersList() {
  return within(screen.getByRole("region", { name: "Members" })).getByRole("list");
}

function invitationsList() {
  return within(
    screen.getByRole("region", { name: "Pending invitations" })
  ).getByRole("list");
}

describe("AdminPeoplePage", () => {
  beforeEach(() => jest.clearAllMocks());

  describe("members", () => {
    test("lists everyone who joined", async () => {
      setup();
      await settle();
      const names = within(membersList())
        .getAllByRole("listitem")
        .map((row) => row.textContent);
      expect(names).toHaveLength(4);
      expect(names.join(" ")).toContain("Legolas");
      expect(names.join(" ")).toContain("Gimli");
    });

    // The identity is the document id, because that is the uid. Reading a
    // `userId` field instead -- what the view this replaced did -- yields
    // `undefined` for every member, so nobody is ever "you": the Remove button
    // appeared on your own row and called `deleteUser(undefined)`.
    test("marks your own row and offers it no removal", async () => {
      setup();
      await settle();
      const own = within(membersList())
        .getAllByRole("listitem")
        .find((row) => row.textContent?.includes("Legolas"))!;
      expect(within(own).getByText("You")).toBeInTheDocument();
      expect(within(own).queryByRole("button", { name: "Remove" })).not.toBeInTheDocument();
    });

    test("removes by the id the service expects, never undefined", async () => {
      setup();
      await settle();
      const row = within(membersList())
        .getAllByRole("listitem")
        .find((r) => r.textContent?.includes("Aragorn"))!;
      await userEvent.click(within(row).getByRole("button", { name: "Remove" }));
      const dialog = await screen.findByRole("dialog");
      await userEvent.click(within(dialog).getByRole("button", { name: /delete/i }));
      await settle();
      expect(deleteUser).toHaveBeenCalledWith("u3");
    });

    test("still identifies you if a document does carry a userId field", async () => {
      setup({
        members: [
          { id: "u1", userId: "u1", username: "Legolas", role: "member" },
        ],
      });
      await settle();
      expect(within(membersList()).getByText("You")).toBeInTheDocument();
    });

    // SEC-002 (T080). A member could set `userId` on their own profile to an
    // innocent member's uid; removing the forger's row removed the innocent
    // member instead, and the forger stayed. Only the document id names a
    // member.
    describe("a profile whose stored userId names someone else", () => {
      const FORGED: GroupMember[] = [
        { id: "u1", username: "Legolas", role: "admin" },
        { id: "u3", username: "Aragorn", role: "member" },
        { id: "u4", userId: "u3", username: "Gimli", role: "member" },
      ];
      const rowOf = (name: string) =>
        within(membersList())
          .getAllByRole("listitem")
          .find((r) => r.textContent?.includes(name))!;

      test("removing that row removes its own member, not the one it names", async () => {
        setup({ members: FORGED });
        await settle();
        await userEvent.click(within(rowOf("Gimli")).getByRole("button", { name: "Remove" }));
        const dialog = await screen.findByRole("dialog");
        await userEvent.click(within(dialog).getByRole("button", { name: /delete/i }));
        await settle();
        expect(deleteUser).toHaveBeenCalledWith("u4");
        expect(deleteUser).not.toHaveBeenCalledWith("u3");
      });

      test("a role change on that row targets its own member", async () => {
        setup({ members: FORGED });
        await settle();
        await userEvent.click(within(rowOf("Gimli")).getByRole("button", { name: "Make admin" }));
        const dialog = await screen.findByRole("dialog");
        await userEvent.click(within(dialog).getByRole("button", { name: "Make admin" }));
        await settle();
        expect(setMemberRole).toHaveBeenCalledWith("u4", "admin");
      });

      test("naming you does not make that row yours", async () => {
        setup({ members: [...FORGED, { id: "u5", userId: "u1", username: "Boromir", role: "member" }] });
        await settle();
        expect(within(rowOf("Boromir")).queryByText("You")).not.toBeInTheDocument();
        expect(within(rowOf("Boromir")).getByRole("button", { name: "Remove" })).toBeInTheDocument();
      });
    });

    // T034. Roles change through the `setMemberRole` Cloud Function, which
    // refuses to leave the group without an admin (T035); the rules refuse a
    // client write to `role` outright.
    describe("roles", () => {
      const rowOf = (name: string) =>
        within(membersList())
          .getAllByRole("listitem")
          .find((row) => row.textContent?.includes(name))!;

      test("offers your own row no role control", async () => {
        setup();
        await settle();
        expect(within(rowOf("Legolas")).queryByRole("button", { name: /make/i }))
          .not.toBeInTheDocument();
      });

      test("promotes a member only after a confirmation that says what it grants", async () => {
        setup();
        await settle();
        await userEvent.click(within(rowOf("Aragorn")).getByRole("button", { name: "Make admin" }));
        const dialog = await screen.findByRole("dialog");
        expect(dialog).toHaveTextContent(/Make Aragorn an admin\?/);
        expect(dialog).toHaveTextContent(/including yours/);
        expect(setMemberRole).not.toHaveBeenCalled();

        await userEvent.click(within(dialog).getByRole("button", { name: "Make admin" }));
        await settle();
        expect(setMemberRole).toHaveBeenCalledWith("u3", "admin");
      });

      test("cancelling a promotion changes nothing", async () => {
        setup();
        await settle();
        await userEvent.click(within(rowOf("Aragorn")).getByRole("button", { name: "Make admin" }));
        const dialog = await screen.findByRole("dialog");
        await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
        expect(setMemberRole).not.toHaveBeenCalled();
      });

      test("makes another admin a member at once, and offers no removal until then", async () => {
        setup();
        await settle();
        const row = rowOf("DungeonMaster");
        expect(within(row).queryByRole("button", { name: "Remove" })).not.toBeInTheDocument();
        await userEvent.click(within(row).getByRole("button", { name: "Make member" }));
        await settle();
        expect(setMemberRole).toHaveBeenCalledWith("u2", "member");
      });

      test("shows the server's refusal", async () => {
        setMemberRole.mockRejectedValueOnce(new Error("You are this group's only admin."));
        setup();
        await settle();
        await userEvent.click(within(rowOf("DungeonMaster")).getByRole("button", { name: "Make member" }));
        await settle();
        expect(await screen.findByRole("alert")).toHaveTextContent("only admin");
      });
    });

    test("states the role in words, with no badge or status colour", async () => {
      setup();
      await settle();
      const row = within(membersList())
        .getAllByRole("listitem")
        .find((r) => r.textContent?.includes("Aragorn"))!;
      expect(within(row).getByText("Member")).toBeInTheDocument();
      expect(row.className).not.toMatch(/bg-(red|green|amber|yellow)/);
    });

    test("removing a member asks first, naming the blast radius", async () => {
      setup();
      await settle();
      const row = within(membersList())
        .getAllByRole("listitem")
        .find((r) => r.textContent?.includes("Aragorn"))!;
      await userEvent.click(within(row).getByRole("button", { name: "Remove" }));

      const dialog = await screen.findByRole("dialog");
      expect(dialog).toHaveTextContent(/Remove Aragorn from The Fellowship/);
      expect(dialog).toHaveTextContent(/cannot be undone/i);
      expect(deleteUser).not.toHaveBeenCalled();
    });

    test("searching filters the list", async () => {
      setup();
      await settle();
      await userEvent.type(screen.getByLabelText("Search members"), "gimli");
      expect(within(membersList()).getAllByRole("listitem")).toHaveLength(1);
    });
  });

  describe("pending invitations", () => {
    test("shows only what nobody has accepted", async () => {
      setup();
      await settle();
      const rows = within(invitationsList()).getAllByRole("listitem");
      expect(rows).toHaveLength(1);
      expect(rows[0]).toHaveTextContent("Spare invitation");
    });

    test("shows no used token anywhere, in any form", async () => {
      setup();
      await settle();
      expect(screen.queryByText(/used-1|used-2/)).not.toBeInTheDocument();
      expect(screen.queryByText(/^Used$/)).not.toBeInTheDocument();
    });

    test("offers no filter or toggle that would bring them back", async () => {
      setup();
      await settle();
      expect(
        screen.queryByRole("button", { name: /all tokens|show used|filter/i })
      ).not.toBeInTheDocument();
    });

    test("never prints the token string itself", async () => {
      setup();
      await settle();
      expect(within(invitationsList()).queryByText(/spare-1/)).not.toBeInTheDocument();
    });

    test("says so plainly when an invitation has no note", async () => {
      setup({ tokens: [{ id: "t", used: false, createdAt: new Date("2025-05-31") }] });
      await settle();
      expect(screen.getByText("Not yet sent to anyone")).toBeInTheDocument();
    });

    // T013: a row says when its invitation stops working.
    test("states when an invitation expires", async () => {
      const inAWeek = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      setup({ tokens: [{ id: "t", used: false, createdAt: new Date(), expiresAt: inAWeek }] });
      await settle();
      const row = within(invitationsList()).getByRole("listitem");
      expect(row).toHaveTextContent(/Expires /);
      expect(within(row).getByRole("button", { name: "Copy link" })).toBeInTheDocument();
    });

    test("an expired invitation says so and offers no link, only revoking", async () => {
      setup({
        tokens: [
          { id: "t", used: false, createdAt: new Date("2025-05-01"), expiresAt: new Date("2025-05-15") },
        ],
      });
      await settle();
      const row = within(invitationsList()).getByRole("listitem");
      expect(row).toHaveTextContent(/Expired /);
      expect(within(row).queryByRole("button", { name: "Copy link" })).not.toBeInTheDocument();
      expect(within(row).getByRole("button", { name: "Revoke" })).toBeInTheDocument();
    });

    test("an invitation from before expiry existed still says when it was made", async () => {
      setup({ tokens: [{ id: "t", used: false, createdAt: new Date("2025-05-31") }] });
      await settle();
      const row = within(invitationsList()).getByRole("listitem");
      expect(row).toHaveTextContent(/Created /);
      expect(row).not.toHaveTextContent(/Expire/);
      expect(within(row).getByRole("button", { name: "Copy link" })).toBeInTheDocument();
    });

    test("reads as new rather than broken when there are none", async () => {
      setup({ tokens: [] });
      await settle();
      expect(
        screen.getByText(/No invitations waiting/i)
      ).toBeInTheDocument();
    });
  });

  describe("naming an invitation after the fact", () => {
    // Creating an invitation asks for nothing, so this is where a note gets
    // attached. Without it the note could never be set at all, and the note is
    // the only thing telling one pending invitation from another -- the token
    // string is never rendered.
    test("the note is an inline edit on the row, not a field before the action", async () => {
      setup();
      await settle();
      await userEvent.click(
        screen.getByRole("button", { name: /Edit who this invitation is for/i })
      );
      expect(
        screen.getByLabelText("Who is this invitation for?")
      ).toBeInTheDocument();
    });

    test("takes no more of a note than the rules keep, 200 characters (T145)", async () => {
      setup();
      await settle();
      await userEvent.click(
        screen.getByRole("button", { name: /Edit who this invitation is for/i })
      );
      const field = screen.getByLabelText("Who is this invitation for?");
      await userEvent.clear(field);
      await userEvent.type(field, "x".repeat(205));
      expect(field).toHaveValue("x".repeat(200));
    });

    test("saving writes the note and updates the row", async () => {
      setup();
      await settle();
      await userEvent.click(
        screen.getByRole("button", { name: /Edit who this invitation is for/i })
      );
      const field = screen.getByLabelText("Who is this invitation for?");
      await userEvent.clear(field);
      await userEvent.type(field, "For Boromir");
      await userEvent.click(screen.getByRole("button", { name: "Save" }));
      await settle();

      expect(updateRegistrationTokenNotes).toHaveBeenCalledWith(
        "spare-1",
        "For Boromir"
      );
      expect(
        within(invitationsList()).getByText("For Boromir")
      ).toBeInTheDocument();
    });

    test("cancelling leaves the note alone", async () => {
      setup();
      await settle();
      await userEvent.click(
        screen.getByRole("button", { name: /Edit who this invitation is for/i })
      );
      await userEvent.type(
        screen.getByLabelText("Who is this invitation for?"),
        "discard me"
      );
      await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

      expect(updateRegistrationTokenNotes).not.toHaveBeenCalled();
      expect(
        within(invitationsList()).getByText("Spare invitation")
      ).toBeInTheDocument();
    });

    test("an unnamed invitation can be named", async () => {
      setup({ tokens: [{ id: "t", used: false, createdAt: new Date("2025-05-31") }] });
      await settle();
      await userEvent.click(
        screen.getByRole("button", { name: /Say who this invitation is for/i })
      );
      await userEvent.type(
        screen.getByLabelText("Who is this invitation for?"),
        "For Boromir"
      );
      await userEvent.click(screen.getByRole("button", { name: "Save" }));
      await settle();
      expect(updateRegistrationTokenNotes).toHaveBeenCalledWith("t", "For Boromir");
    });

    test("an unchanged note is not written at all", async () => {
      setup();
      await settle();
      await userEvent.click(
        screen.getByRole("button", { name: /Edit who this invitation is for/i })
      );
      await userEvent.click(screen.getByRole("button", { name: "Save" }));
      await settle();
      expect(updateRegistrationTokenNotes).not.toHaveBeenCalled();
    });
  });

  describe("inviting someone", () => {
    test("takes one click and no form", async () => {
      setup();
      await settle();
      const region = screen.getByRole("region", { name: "Members" });
      expect(within(region).queryByLabelText(/note/i)).not.toBeInTheDocument();

      await userEvent.click(
        within(region).getAllByRole("button", { name: "Invite someone" })[0]
      );
      await settle();
      expect(generateRegistrationToken).toHaveBeenCalledWith("");
    });

    test("opens a dialog holding a working /join link", async () => {
      setup();
      await settle();
      await userEvent.click(
        screen.getAllByRole("button", { name: "Invite someone" })[0]
      );
      await settle();

      const dialog = await screen.findByRole("dialog");
      expect(within(dialog).getByText(/\/join\?token=fresh-token/)).toBeInTheDocument();
      expect(within(dialog).getByRole("button", { name: /copy/i })).toBeInTheDocument();
    });

    test("the dialog names the consequence and has one closing button", async () => {
      setup();
      await settle();
      await userEvent.click(
        screen.getAllByRole("button", { name: "Invite someone" })[0]
      );
      await settle();

      const dialog = await screen.findByRole("dialog");
      expect(dialog).toHaveTextContent(
        /Anyone with this link can join The Fellowship once/
      );
      expect(within(dialog).getByRole("button", { name: "Done" })).toBeInTheDocument();
    });

    // T013: a new link lapses after 14 days, so "it expires when used" would
    // be only half the truth.
    test("the dialog for a new invitation names the day it stops working", async () => {
      setup();
      await settle();
      await userEvent.click(
        screen.getAllByRole("button", { name: "Invite someone" })[0]
      );
      await settle();

      const inFourteenDays = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
      const dialog = await screen.findByRole("dialog");
      expect(dialog).toHaveTextContent(/once, until /);
      expect(dialog).toHaveTextContent(String(inFourteenDays.getFullYear()));
      expect(dialog).not.toHaveTextContent(/expires when used/);
    });

    test("copies an open invitation's link from the token the server reveals, never from its id (T145)", async () => {
      setup();
      await settle();
      await userEvent.click(screen.getByRole("button", { name: "Copy link" }));

      expect(revealRegistrationToken).toHaveBeenCalledWith("spare-1");
      const dialog = await screen.findByRole("dialog");
      expect(within(dialog).getByText(/\/join\?token=revealed-token/)).toBeInTheDocument();
      expect(dialog).not.toHaveTextContent(/spare-1/);
    });

    test("says why when the link cannot be shown again, and opens nothing", async () => {
      setup();
      revealRegistrationToken.mockRejectedValue(
        new Error("This invitation's link cannot be shown again. Revoke it and invite them again.")
      );
      await settle();
      await userEvent.click(screen.getByRole("button", { name: "Copy link" }));
      await settle();

      expect(screen.getByRole("alert")).toHaveTextContent(/cannot be shown again/);
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    test("copying a pre-expiry invitation's link still says it lapses only when used", async () => {
      setup({ tokens: [{ id: "t", used: false, createdAt: new Date("2025-05-31") }] });
      await settle();
      await userEvent.click(screen.getByRole("button", { name: "Copy link" }));

      const dialog = await screen.findByRole("dialog");
      expect(dialog).toHaveTextContent(/It expires when used/);
    });
  });

  describe("revoking an invitation", () => {
    test("asks first, then removes the row", async () => {
      setup();
      await settle();
      await userEvent.click(screen.getByRole("button", { name: "Revoke" }));

      const dialog = await screen.findByRole("dialog");
      expect(dialog).toHaveTextContent(/The link stops working immediately/);

      await userEvent.click(within(dialog).getByRole("button", { name: /delete/i }));
      await settle();

      expect(deleteRegistrationToken).toHaveBeenCalledWith("spare-1");
      // It was the only one, so the card falls back to its empty state rather
      // than an empty list.
      const region = screen.getByRole("region", { name: "Pending invitations" });
      expect(within(region).queryByText("Spare invitation")).not.toBeInTheDocument();
      expect(within(region).getByText(/No invitations waiting/i)).toBeInTheDocument();
    });
  });

  // T128: a group holds at most ten members, so a full one offers no new
  // invitation, which could only fail when used.
  describe("a full group", () => {
    const TEN: GroupMember[] = Array.from({ length: 10 }, (_, i) => ({
      id: i === 0 ? "u1" : `u${i + 1}`,
      username: i === 0 ? "Legolas" : `Member${i + 1}`,
      role: i === 0 ? "admin" : "member",
      joinedAt: new Date("2025-05-31"),
    }));

    test("says it is full and offers no invitation", async () => {
      setup({ members: TEN });
      await settle();
      for (const button of screen.getAllByRole("button", { name: "Invite someone" })) {
        expect(button).toBeDisabled();
      }
      expect(screen.getByText(/this group is full/i)).toBeInTheDocument();
      expect(screen.getByText("10 of 10")).toBeInTheDocument();
    });

    test("one place short of full still invites", async () => {
      setup({ members: TEN.slice(0, 9) });
      await settle();
      expect(screen.getAllByRole("button", { name: "Invite someone" })[0]).toBeEnabled();
      expect(screen.queryByText(/this group is full/i)).not.toBeInTheDocument();
    });
  });
});
