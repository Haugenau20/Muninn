// pages/HomePage.tsx
import { recordTimes } from 'core/attribution';
import React from 'react';
import { useStory } from 'features/storytelling';
import { useQuests } from 'features/campaign-entities';
import { useRumors } from 'features/campaign-entities';
import { useNPCs } from 'features/campaign-entities';
import { useLocations } from 'features/campaign-entities';
import { lastActorName } from 'shared/utils/author-name';
import { useMemberDirectory } from 'shared/hooks/useMemberDirectory';
import { usePageGate, GatedContent } from 'shared/components/gated';
import PageShell from 'shared/components/page-shell/PageShell';
import SignedOutHome from 'pages/home/SignedOutHome';

// Import layouts
import DashboardLayout from 'pages/layouts/dashboard/DashboardLayout';
import useLayoutData from 'pages/layouts/common/hooks/useLayoutData';
import CampaignBanner from 'pages/layouts/dashboard/sections/CampaignBanner';
import { rumorTitleText } from 'features/campaign-entities';
import type { Activity } from 'pages/layouts/common/types';

export type { Activity };

/**
 * HomePage component serving as the container for the dashboard layout.
 */
const HomePage: React.FC = () => {
  // Load data from all contexts
  const { chapters, isLoading: chaptersLoading } = useStory();
  const { quests, isLoading: questsLoading } = useQuests();
  const { rumors, isLoading: rumorsLoading } = useRumors();
  const { npcs, isLoading: npcsLoading } = useNPCs();
  const { locations, isLoading: locationsLoading } = useLocations();
  
  // Who touched each record last, by the name they have now (T132): the
  // group's members, followed live, rather than a fetch of every uid named.
  const directory = useMemberDirectory();

  // Create combined recent activity from all content types
  const activities = React.useMemo(() => {
    /** Who touched a record last, by the name they have now. */
    const determineActor = (item: Parameters<typeof lastActorName>[0]): string =>
      lastActorName(item, directory);

    const allActivities: Activity[] = [];
    
    // Add chapters
    chapters.forEach(chapter => {
      const touched = recordTimes(chapter).modified;
      if (touched) {
        allActivities.push({
          id: chapter.id,
          type: 'chapter',
          title: chapter.title,
          // The text is not on the chapter since T134; the form always writes a summary.
          description: chapter.summary ?? '',
          actor: determineActor(chapter),
          timestamp: touched,
          link: `/story/chapters/${chapter.id}`
        });
      }
    });
    
    // Add quests
    quests.forEach(quest => {
      const touched = recordTimes(quest).modified;
      if (touched) {
        allActivities.push({
          id: quest.id,
          type: 'quest',
          title: quest.title,
          description: quest.description,
          actor: determineActor(quest),
          timestamp: touched,
          link: `/quests/${quest.id}`
        });
      }
    });

    // Add rumors
    rumors.forEach(rumor => {
      const touched = recordTimes(rumor).modified;
      if (touched) {
        allActivities.push({
          id: rumor.id,
          type: 'rumor',
          title: rumorTitleText(rumor),
          description: rumor.content.substring(0, 100) + '...',
          actor: determineActor(rumor),
          timestamp: touched,
          link: `/rumors?highlight=${rumor.id}`
        });
      }
    });

    // Add NPCs
    npcs.forEach(npc => {
      const touched = recordTimes(npc).modified;
      if (touched) {
        allActivities.push({
          id: npc.id,
          type: 'npc',
          title: npc.name,
          description: npc.description.substring(0, 100) + '...',
          actor: determineActor(npc),
          timestamp: touched,
          link: `/npcs?highlight=${npc.id}`
        });
      }
    });

    // Add locations
    locations.forEach(location => {
      const touched = recordTimes(location).modified;
      if (touched) {
        allActivities.push({
          id: location.id,
          type: 'location',
          title: location.name,
          description: location.description.substring(0, 100) + '...',
          actor: determineActor(location),
          timestamp: touched,
          link: `/locations?highlight=${location.id}`
        });
      }
    });
    
    // Sort by timestamp (newest first)
    return allActivities.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  }, [chapters, quests, rumors, npcs, locations, directory]);
  
  // Use common layout data hook to process and prepare data
  const layoutData = useLayoutData({
    chapters,
    quests,
    rumors,
    npcs,
    locations,
    activities,
    chaptersLoading,
    questsLoading,
    rumorsLoading,
    npcsLoading,
    locationsLoading
  });
  
  const gate = usePageGate('home', { loading: layoutData.loading });

  // Signed-out Home is a different layout from the shared panel -- the h1
  // there is the product's headline, not a page title. See `SignedOutHome`.
  if (gate.state === 'signed-out') {
    return <SignedOutHome />;
  }

  // CampaignBanner supplies the page's h1 in the ready state. PageShell
  // supplies it here, where no banner renders -- which is exactly where "you
  // can still see where you are" matters. Using both would put two h1s on one
  // page.
  if (gate.state !== 'ready') {
    return (
      <PageShell title="Campaign Home">
        <GatedContent gate={gate}>{null}</GatedContent>
      </PageShell>
    );
  }

  return (
    <>
      {/* The hero band sits outside the page column on purpose. It bleeds to the
          viewport edges, and the column below sets `overflow-x-hidden`, which
          clips anything wider than itself -- the band's layout box was already
          full width, but its paint was cut back, so it rendered as a floating
          card with the page showing either side. Nothing inside a clipping
          ancestor can bleed past it. */}
      <CampaignBanner chapterCount={chapters.length} />

    <div className='max-w-7xl mx-auto'>
      <div className="container mx-auto px-2 sm:px-4 py-4 overflow-x-hidden content">
        <DashboardLayout
          npcs={npcs}
          locations={locations}
          quests={quests}
          chapters={chapters}
          rumors={rumors}
          activities={activities}
          loading={layoutData.loading}
        />
      </div>
    </div>
    </>
  );
};

export default HomePage;