// src/features/campaign-entities/example/__tests__/ExampleCampaignProvider.test.tsx
import React from "react";
import { act, render, screen } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { NavigationProvider, useNavigation } from "shared/context/NavigationContext";
import { useNPCs } from "../../npcs/context/NPCContext";
import { useLocations } from "../../locations/context/LocationContext";
import { useQuests } from "../../quests/context/QuestContext";
import { useRumors } from "../../rumors/context/RumorContext";
import ExampleCampaignProvider from "../ExampleCampaignProvider";

type Values = {
  npcs: ReturnType<typeof useNPCs>;
  locations: ReturnType<typeof useLocations>;
  quests: ReturnType<typeof useQuests>;
  rumors: ReturnType<typeof useRumors>;
  navigation: ReturnType<typeof useNavigation>;
};

let seen: Values;

const Probe: React.FC = () => {
  const { pathname } = useLocation();
  seen = {
    npcs: useNPCs(),
    locations: useLocations(),
    quests: useQuests(),
    rumors: useRumors(),
    navigation: useNavigation(),
  };
  return <p data-testid="where">{pathname}</p>;
};

const renderProvider = () =>
  render(
    <MemoryRouter initialEntries={["/npcs"]}>
      <NavigationProvider>
        <ExampleCampaignProvider>
          <Probe />
        </ExampleCampaignProvider>
      </NavigationProvider>
    </MemoryRouter>
  );

describe("ExampleCampaignProvider", () => {
  it("serves the example as each list's loaded records", () => {
    renderProvider();
    expect(seen.npcs.npcs).toHaveLength(10);
    expect(seen.locations.locations).toHaveLength(10);
    expect(seen.quests.quests).toHaveLength(10);
    expect(seen.rumors.rumors).toHaveLength(10);
    [seen.npcs, seen.locations, seen.quests, seen.rumors].forEach((value) => {
      expect(value.isLoading).toBe(false);
      expect(value.loadError).toBeNull();
    });
    [seen.npcs, seen.locations, seen.quests].forEach((value) => expect(value.hasRequiredContext).toBe(true));
  });

  it("finds a record by its id, as the directories look people and quests up", () => {
    renderProvider();
    expect(seen.npcs.getNPCById("example-npc-vesk")?.name).toBe("Vesk Harrow");
    expect(seen.quests.getQuestById("example-quest-ledger")?.title).toBe("Recover the drowned ledger");
    expect(seen.locations.getLocationById("example-location-fen")).toBeUndefined();
    expect(seen.locations.getLocationById("example-location-saltmarsh-fen")?.name).toBe("Saltmarsh Fen");
  });

  // The guarantee the whole example rests on: every write anything inside it
  // can reach settles quietly and changes nothing.
  it("answers every write by changing nothing", async () => {
    renderProvider();
    const before = JSON.stringify([seen.npcs.npcs, seen.locations.locations, seen.quests.quests, seen.rumors.rumors]);
    const writes = [seen.npcs, seen.locations, seen.quests, seen.rumors].flatMap((value) =>
      Object.entries(value)
        .filter(([key, member]) => typeof member === "function" && !/^get|^refresh/.test(key))
        .map(([key, member]) => [key, member as (...args: unknown[]) => unknown] as const)
    );
    expect(writes.length).toBeGreaterThan(30);
    await act(async () => {
      for (const [, write] of writes) {
        await write("example-npc-vesk", "hostile", "x");
      }
    });
    const after = JSON.stringify([seen.npcs.npcs, seen.locations.locations, seen.quests.quests, seen.rumors.rumors]);
    expect(after).toBe(before);
  });

  it("goes nowhere when something inside asks to leave", () => {
    renderProvider();
    act(() => seen.navigation.navigateToPage("/npcs/example-npc-vesk"));
    expect(screen.getByTestId("where")).toHaveTextContent(/^\/npcs$/);
    expect(seen.navigation.getCurrentQueryParams()).toEqual({});
  });
});
