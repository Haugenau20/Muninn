// src/app/App.tsx
import React, { Suspense, useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { NavigationProvider } from 'shared/context/NavigationContext';
import { SearchProvider } from 'shared/context/SearchContext';
import { NPCProvider, LocationProvider, RumorProvider, PrivateRecordsProvider } from 'features/campaign-entities';
import { StoryProvider } from 'features/storytelling';
import {
  FirebaseProvider,
  SessionTimeoutWarning,
  SessionManager,
  PrivacyNotice
} from 'features/user-management';
import { QuestProvider } from 'features/campaign-entities';
import { NoteProvider, UsageProvider } from 'features/collaboration';
import { QuickAddProvider } from 'shared/context/QuickAddProvider';
import ErrorBoundary from 'shared/components/ErrorBoundary';
import Layout from 'app/layout/Layout';
import EditRouteRedirect from 'app/EditRouteRedirect';
import RecordRoute from 'app/RecordRoute';
import RouteFallback from 'app/RouteFallback';
import DocumentTitle from 'app/DocumentTitle';
import AnalyticsPageView from 'app/AnalyticsPageView';
import { lazyPage, prefetchPages } from 'app/lazyPage';

// Eager: the front door, which most visits open on, and the not-found page,
// which is a few lines and should never be the thing that fails to load.
import HomePage from 'pages/HomePage';
import NotFoundPage from 'pages/NotFoundPage';

// Everything else loads on first visit (T030). `prefetchPages` then fetches
// each chunk at idle once the app is up, so a later visit finds it cached.
// The admin and auth pages are imported from their own files rather than
// `user-management`'s barrel: the barrel is already in `main.js` for its
// providers, and a page reached through it could not be split off.
const StoryPage = lazyPage(() => import('pages/story'), 'StoryPage');
const SagaPage = lazyPage(() => import('pages/story'), 'SagaPage');
const SagaEditPage = lazyPage(() => import('pages/story'), 'SagaEditPage');
const ChaptersPage = lazyPage(() => import('pages/story'), 'ChaptersPage');
const ChapterCreatePage = lazyPage(() => import('pages/story'), 'ChapterCreatePage');
const ChapterEditPage = lazyPage(() => import('pages/story'), 'ChapterEditPage');
const QuestsPage = lazyPage(() => import('pages/quests'), 'QuestsPage');
const QuestCreatePage = lazyPage(() => import('pages/quests'), 'QuestCreatePage');
const QuestDetailPage = lazyPage(() => import('pages/quests'), 'QuestDetailPage');
const NPCsPage = lazyPage(() => import('pages/npcs'), 'NPCsPage');
const NPCsCreatePage = lazyPage(() => import('pages/npcs'), 'NPCsCreatePage');
const NPCDetailPage = lazyPage(() => import('pages/npcs'), 'NPCDetailPage');
const LocationsPage = lazyPage(() => import('pages/locations'), 'LocationsPage');
const LocationCreatePage = lazyPage(() => import('pages/locations'), 'LocationCreatePage');
const LocationDetailPage = lazyPage(() => import('pages/locations'), 'LocationDetailPage');
const RumorsPage = lazyPage(() => import('pages/rumors'), 'RumorsPage');
const NotesPage = lazyPage(() => import('pages/notes'), 'NotesPage');
const NotePage = lazyPage(() => import('pages/notes'), 'NotePage');
const PrivacyPolicyPage = lazyPage(() => import('pages/PrivacyPolicyPage'), 'default');
const ContactPage = lazyPage(() => import('pages/ContactPage'), 'default');
const AboutPage = lazyPage(() => import('pages/AboutPage'), 'default');
const ProfilePage = lazyPage(() => import('pages/profile'), 'ProfilePage');
const AdminLayout = lazyPage(
  () => import('features/user-management/admin/pages/AdminLayout'),
  'default'
);
const AdminPeoplePage = lazyPage(
  () => import('features/user-management/admin/pages/AdminPeoplePage'),
  'default'
);
const AdminCampaignsPage = lazyPage(
  () => import('features/user-management/admin/pages/AdminCampaignsPage'),
  'default'
);
const AdminGroupPage = lazyPage(
  () => import('features/user-management/admin/pages/AdminGroupPage'),
  'default'
);
const SignInPage = lazyPage(
  () => import('features/user-management/auth/pages/SignInPage'),
  'default'
);
const EmailLinkPage = lazyPage(
  () => import('features/user-management/auth/pages/EmailLinkPage'),
  'default'
);
const JoinPage = lazyPage(
  () => import('features/user-management/groups/pages/JoinPage'),
  'default'
);

const App: React.FC = () => {
  // Production only: in jest and the dev server it would import every page
  // for nothing.
  useEffect(() => {
    if (process.env.NODE_ENV === 'production') prefetchPages();
  }, []);

  return (
    <ErrorBoundary>
      <FirebaseProvider>
        <SessionManager>
          <NavigationProvider>
            {/* The author's private records, which every list adds to its own (T163). */}
            <PrivateRecordsProvider>
            <NPCProvider>
              <LocationProvider>
                <StoryProvider>
                  <RumorProvider>
                    <QuestProvider>
                      <NoteProvider>
                        <UsageProvider>
                          <SearchProvider>
                            {/* Inside every entity provider: the quick-add form
                                calls their write methods. */}
                            <QuickAddProvider>
                              <Layout>
                                <SessionTimeoutWarning />
                                <PrivacyNotice />
                                <DocumentTitle />
                                <AnalyticsPageView />
                                {/* One boundary for every route, mounted
                                    once: a transition only holds the old
                                    page up for a boundary that is already
                                    showing, so a boundary per route would
                                    flash the fallback on each first visit. */}
                                <Suspense fallback={<RouteFallback />}>
                                  <Routes>
                                    <Route path="/" element={<HomePage />} />
                                    {/* `/story` is now the chapters index; the old dedicated
                                        selection page is gone (see git history for
                                        StorySelectionPage). `/story/selection` redirects so
                                        existing bookmarks don't 404. */}
                                    <Route path="/story" element={<ChaptersPage />} />
                                    <Route path="/story/selection" element={<Navigate to="/story" replace />} />
                                    <Route path="/story/chapters" element={<ChaptersPage />} />
                                    <Route path="/story/chapters/:chapterId" element={<StoryPage />} />
                                    <Route path="/story/saga" element={<SagaPage />} />
                                    <Route path="/story/saga/edit" element={<SagaEditPage />} />
                                    <Route path="/story/chapters/create" element={<ChapterCreatePage />} />
                                    <Route path="/story/chapters/edit/:chapterId" element={<ChapterEditPage />} />
                                    <Route path="/quests" element={<QuestsPage />} />
                                    <Route path="/quests/create" element={<QuestCreatePage />} />
                                    {/* Retired in `15-8`. The record is where
                                        editing happens now; the URL still
                                        resolves, because it is in histories and
                                        in notes. */}
                                    <Route
                                      path="/quests/edit/:questId"
                                      element={
                                        <EditRouteRedirect
                                          param="questId"
                                          destination={(id) => `/quests/${id}`}
                                          fallback="/quests"
                                        />
                                      }
                                    />
                                    {/* After the two literal segments, so
                                        `/quests/create` and `/quests/edit/x` keep
                                        their own pages rather than being read as
                                        a quest id. */}
                                    <Route
                                      path="/quests/:questId"
                                      element={<RecordRoute param="questId"><QuestDetailPage /></RecordRoute>}
                                    />
                                    <Route path="/npcs" element={<NPCsPage />} />
                                    <Route path="/npcs/create" element={<NPCsCreatePage />} />
                                    <Route
                                      path="/npcs/edit/:npcId"
                                      element={
                                        <EditRouteRedirect
                                          param="npcId"
                                          destination={(id) => `/npcs/${id}`}
                                          fallback="/npcs"
                                        />
                                      }
                                    />
                                    {/* Each record gets its own page, so an editor cannot carry one
                                        record's draft into the next (REACT-001). */}
                                    <Route
                                      path="/npcs/:npcId"
                                      element={<RecordRoute param="npcId"><NPCDetailPage /></RecordRoute>}
                                    />
                                    <Route path="/locations" element={<LocationsPage />} />
                                    <Route path="/locations/create" element={<LocationCreatePage />} />
                                    <Route
                                      path="/locations/edit/:locationId"
                                      element={
                                        <EditRouteRedirect
                                          param="locationId"
                                          destination={(id) => `/locations/${id}`}
                                          fallback="/locations"
                                        />
                                      }
                                    />
                                    {/* After the two literal segments, so
                                        `/locations/create` and `/locations/edit/x`
                                        keep their own pages rather than being read
                                        as a location id. */}
                                    <Route
                                      path="/locations/:locationId"
                                      element={<RecordRoute param="locationId"><LocationDetailPage /></RecordRoute>}
                                    />
                                    <Route path="/rumors" element={<RumorsPage />} />
                                    {/* `15-9` retired the create form. A rumour
                                        has no page, so there was nothing for
                                        `/rumors/create` to be: note conversion
                                        now writes the record and opens its row,
                                        and the composer sits at the top of the
                                        list. The address survives as a redirect
                                        so anything already pointing here lands
                                        somewhere true. */}
                                    <Route path="/rumors/create" element={<Navigate to="/rumors" replace />} />
                                    {/* A rumour has no page by design (§2.1),
                                        so its old edit URL goes to the row:
                                        `?highlight=` opens it in place. */}
                                    <Route
                                      path="/rumors/edit/:rumorId"
                                      element={
                                        <EditRouteRedirect
                                          param="rumorId"
                                          destination={(id) => `/rumors?highlight=${id}`}
                                          fallback="/rumors"
                                        />
                                      }
                                    />
                                    <Route path="/notes" element={<NotesPage />} />
                                    <Route
                                      path="/notes/:noteId"
                                      element={<RecordRoute param="noteId"><NotePage /></RecordRoute>}
                                    />
                                    <Route path="/privacy" element={<PrivacyPolicyPage />} />
                                    <Route path="/contact" element={<ContactPage />} />
                                    <Route path="/about" element={<AboutPage />} />
                                    <Route path="/profile" element={<ProfilePage />} />
                                    {/* Admin and auth are places, not decisions
                                        taken about the page behind them, so they
                                        are routes. `AdminLayout` owns the band,
                                        the sub-navigation and the three states
                                        that decide whether any of it renders. */}
                                    <Route path="/admin" element={<AdminLayout />}>
                                      <Route index element={<Navigate to="/admin/people" replace />} />
                                      {/* Absolute child paths, which React Router
                                          allows where they extend the parent's:
                                          the route table then reads as the URLs
                                          people actually visit. */}
                                      <Route path="/admin/people" element={<AdminPeoplePage />} />
                                      <Route path="/admin/campaigns" element={<AdminCampaignsPage />} />
                                      <Route path="/admin/group" element={<AdminGroupPage />} />
                                    </Route>
                                    <Route path="/signin" element={<SignInPage />} />
                                    <Route path="/auth/link" element={<EmailLinkPage />} />
                                    <Route path="/join" element={<JoinPage />} />
                                    {/* Last: any address no route above claims. */}
                                    <Route path="*" element={<NotFoundPage />} />
                                  </Routes>
                                </Suspense>
                              </Layout>
                            </QuickAddProvider>
                          </SearchProvider>
                        </UsageProvider>
                      </NoteProvider>
                    </QuestProvider>
                  </RumorProvider>
                </StoryProvider>
              </LocationProvider>
            </NPCProvider>
            </PrivateRecordsProvider>
          </NavigationProvider>
        </SessionManager>
      </FirebaseProvider>
    </ErrorBoundary>
  );
};

export default App;