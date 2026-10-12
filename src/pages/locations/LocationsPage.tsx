// src/pages/locations/LocationsPage.tsx
import React from "react";
import Button from "core/components/Button";
import { useLocations, LocationDirectory, LocationExample } from "features/campaign-entities";
import { usePageGate, GatedContent } from "shared/components/gated";
import PageShell from "shared/components/page-shell/PageShell";
import { useNavigation } from "shared/context/NavigationContext";
import { Plus } from "lucide-react";

/**
 * Locations index.
 *
 * `hasRequiredContext` from `useLocations()` is deliberately unused: it cannot
 * tell "no selection" from "still restoring", and it cannot tell either from
 * "signed out". `usePageGate` distinguishes all three.
 */
const LocationsPage: React.FC = () => {
  const { navigateToPage } = useNavigation();
  const { locations, isLoading, loadError } = useLocations();

  const gate = usePageGate("locations", { loading: isLoading, error: loadError });

  return (
    <PageShell
      title="Locations"
      subtitle="Explore and track the places you've discovered in your adventures"
      actions={
        gate.canAct && (
          <Button
            onClick={() => navigateToPage("/locations/create")}
            startIcon={<Plus className="w-5 h-5" />}
          >
            Add Location
          </Button>
        )
      }
    >
      <GatedContent gate={gate} signedOutExample={<LocationExample />}>
        <LocationDirectory locations={locations} isLoading={false} />
      </GatedContent>
    </PageShell>
  );
};

export default LocationsPage;
