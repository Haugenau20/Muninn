# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## 🚧 ARCHITECTURE EVOLUTION IN PROGRESS

**IMPORTANT**: All four feature domains are migrated, and the `shared/`/`core/` infrastructure pass
(Phase 3e) is essentially complete. `src/context/`, `src/components/`, `src/hooks/`, `src/types/`
and `src/services/` — the old functional layout — no longer exist.

| Domain | Status |
|---|---|
| `features/user-management/` (auth, groups, profiles, admin) | ✅ migrated |
| `features/storytelling/` (chapters, stories, sagas) | ✅ migrated |
| `features/campaign-entities/` (npcs, quests, locations, rumors) | ✅ migrated |
| `features/collaboration/` (notes, AI entity extraction) | ✅ migrated |
| `shared/` + `core/` infrastructure pass | ✅ **essentially complete** (Phase 3e) |

**What that means in practice**: the tree matches the target shape end to end. `app/` holds
`App.tsx` and the layout shell (`Header`, `Footer`, `Navigation`, `Breadcrumb`, `Layout`). `core/`
holds infrastructure with no internal dependencies — `components/`, `themes/`, `config/`,
`constants/`, `services/`, `types/`, `attribution/`. `features/` holds the four migrated domains,
each behind a barrel `index.ts` — import from the barrel, never reach into internals. `pages/`
holds the route components plus the aggregating dashboard/journal layouts. `shared/` holds
cross-domain code that doesn't belong to any one feature — `components/`, `context/`, `hooks/`,
`utils/`. `src/utils/__dev__/`, `src/test-utils/`, `src/styles/`, `src/index.tsx` and
`src/setupTests.ts` deliberately stay where they are — none of them is feature-specific or part of
the dependency graph the rules below describe.

**Two boundary calls that filenames get wrong** — verify by opening the file, not by guessing from
the name: `UsageContext` sounds like shared infrastructure but imports `EntityExtractionService`, so
it is `collaboration/entity-extraction/`. `useSessionManager` sounds like collaboration but tracks
auth session activity via `useAuth`, so it is `user-management/auth/hooks/`. Both are now in their
correct homes.

**A grep lesson this migration learned twice, the hard way**: this codebase indents file bodies, so
`grep "^export"` reports one export in a file that has five — the anchor only matches a top-level
column, and every indented export is invisible to it. Two separate "these are duplicates" /
"this file barely does anything" conclusions during this phase were wrong for exactly this reason.
Open the file and read it; don't infer a file's exports, or its size relative to another file, from
a column-anchored grep.

**All three known deviations from the dependency rules below are now closed** — audited 2026-07-27,
two resolved by decision (amending the rule to match established practice) and one resolved in code
the same day. They are kept here because the reasoning matters when the same questions resurface.

1. **`features/` → other `features/`** happens 26 times (campaign-entities and storytelling both
   depend on user-management; the four entity create/edit forms depend on collaboration for
   `useNotes().markEntityAsConverted`). All go through the target domain's **barrel**; none reaches
   into another feature's internals. **Resolved 2026-07-27**: the dependency rule below is amended
   to match this practice instead of forcing a decoupling seam. Barrel-level coupling is acceptable —
   it's the same public-API contract every consumer of a feature already goes through — because it
   preserves the ability to refactor a domain's internals without breaking the domains that depend on
   it. Internals coupling is the thing the original rule existed to prevent, and audit found none.
2. **`core/` → `features/`, a genuine inversion that blocked creating `core/` at all.**
   **Resolved 2026-07-27 in code.** `AuthService`, `UserService`, `GroupService` and
   `InvitationService` moved back to `services/firebase/{auth,user,group}/` — each file's own header
   comment still named that path, because they originated there and were carried into
   `user-management` only because it migrated first. The four remaining consumers use `UserService`
   purely as a **type** (instances come from `ServiceRegistry`), so those are now `import type` and
   carry no runtime edge. The 9 imports that reached into user-management's internals are gone too:
   its barrel now exports the 7 components external callers need, so `app/App.tsx`,
   `app/layout/Header.tsx` and `shared/components/ContextSwitcher.tsx` go through it.

   **Adding components to that barrel first required removing 12 intra-domain self-barrel imports**,
   which would otherwise have become real cycles (`index.ts` → `AdminPanel.tsx` → `index.ts`). The
   three later-migrated domains have zero such imports; user-management was the pre-pattern outlier.
   **Inside a domain, import siblings directly — never your own barrel.**
3. **`shared/` → `features/`**, found in `shared/components/{AttributionInfo,ContextSwitcher,
   GlobalActionButton}.tsx` and `shared/context/SearchContext.tsx` — a dozen-plus imports across
   those four files, every one going through the target domain's barrel (`user-management`,
   `collaboration`, `storytelling`, `campaign-entities`); none reaches into internals.
   **Resolved 2026-07-27 by amending the rule, not by moving code.** These four are genuinely
   cross-cutting: a search context that indexes several domains at once, an attribution line that
   many entity cards render, a global action button, a group/campaign switcher. They need feature
   *data*, and no single feature can own them. Relocating them would make things strictly worse —
   `AttributionInfo` is consumed by feature components, so moving it to `app/` would create a
   `features/` → `app/` edge, a worse inversion than the one being removed. Avoiding the dependency
   altogether would need a dependency-injection or event seam, which is a behaviour change and out of
   scope for a structural pass. Barrel-level coupling is the same public-API contract every other
   consumer of a feature already uses; internals coupling is what the rules exist to prevent, and the
   audit measured that at zero.

**Related trap in the same file, also resolved**: `services/firebase/index.ts` used to run
`initializeFirebaseServices()` — and therefore `getAnalytics()` — at module scope, so any barrel
re-exporting something with a transitive path to it eagerly initialized Firebase and crashed jsdom
tests. Initialization is now memoized behind `getFirebaseServices()`, with the exported services as
lazy stand-ins, so importing the module is side-effect free and the
`firebaseServices.auth.method()` shape is unchanged. This unblocked
`test-utils/__tests__/enhanced-test-utils.test.tsx`, which had never been able to load.
`collaboration`'s barrel still omits `notes/utils/note-relationships`; that omission is now
belt-and-braces rather than load-bearing.

**Key Documents** (note: `docs/backlog/` no longer exists — these moved):
- `TODO.md` — **start here**; the backlog, its priorities and what is blocked on whom
- `docs/testing/bug-tracking/README.md` — live bug tracker
- `docs/architecture/migration/deep-dive-feature-enhancements.md` - Advanced feature roadmap

## Build Commands

### Current Environment Management

**This is how the project is actually run** (confirmed with the maintainer 2026-07-28):

- Run development: **`.\scripts\start-dev.ps1 -Action start`** — starts the Firebase emulators and
  then `npm start`, **both directly on the host. No Docker is involved.**
- Stop / restart / status: `.\scripts\start-dev.ps1 -Action stop|restart|status` (`stop` exports
  emulator data to `firebase/emulator-data` first, and `start` re-imports it if present)
- Generate sample data: `.\scripts\manage-dev-data.ps1 -Action generate`

#### If the dev server reports errors that `tsc` and `npm run build` do not

Vite pre-bundles dependencies into `node_modules/.vite`. After a dependency change or a branch switch
under a running dev server, a stale pre-bundle can report errors no gate sees: stop it, then
`rm -rf node_modules/.vite` (or `npx vite --force`) and start again. Neither the dev server nor the
build type-checks; `npx tsc --noEmit` does.

### Testing Commands
- Run test suite: `npm test` (jest)
- Coverage: `npm run test:coverage` — CI floor is a uniform **80%** in `jest.config.ts` (lowered from 85/81 during Phase 4 batch 3, at the user's direction)
- Behavioural suites only: `npm run test:behavioral`
- HTML report: `npm run test:html`
- Single file, fast: `npx jest --testTimeout=5000 --maxWorkers=1 --testPathPattern="<pattern>"`

**The suite is expected to be fully green — any red is a regression.** This reverses long-standing
advice in this file, which said a non-zero failure count was normal because the behavioural suites
carried failing bug markers. That stopped being true on 2026-07-28, when the ID-collision cluster
(#002/#004/#009/#012) was fixed. No test pins a defect any more (#1414 and #1415, once pinned
that way, are fixed). Never "fix" a red test by editing it — but equally, don't dismiss one as an
expected marker without checking the tracker first.

### Verifying a change before proposing a merge
- `npx tsc --noEmit` — type errors block the deploy (CI's `Type-check` step; Vite does not type-check)
- `npm test` — compare the failure count against the recorded baseline
- **`npm run build` — required, and not implied by the two above.** It is the only gate that
  bundles: a module that only resolves under jest, or a `process.env` name `vite.config.ts` does not
  replace, fails here. Adding a new top-level `src/` directory also means adding it to the resolver
  allow-list in `jest.config.ts`.

**Three resolvers agree on `baseUrl` and `@/`; `ts-node` honours neither.** Bare `baseUrl` imports
remain the convention in shipped code:

| Resolver | `baseUrl` | `paths` (`@/…`) |
|---|---|---|
| `tsc --noEmit` | ✅ | ✅ |
| jest | ✅ (via `moduleNameMapper`) | ✅ |
| Vite (`npm start`, `npm run build`, via `resolve.tsconfigPaths`) | ✅ | ✅ |
| **`ts-node`** | **❌** | **❌** |

`ts-node` has no `tsconfig-paths` registration in this repo, so it resolves only relative and
`node_modules` specifiers. **A bare `core/services/...` import passes all three standard gates and
then fails at runtime under `ts-node`** — which matters for anything under `src/utils/__dev__/`,
since that is operator tooling run via `npx ts-node` and never bundled. Use **relative** imports
there, and verify by actually running the script; no gate will tell you.

## Code Style Guidelines

### Current Standards
- **TypeScript**: Use strict typing with interfaces/types in dedicated files
- **Theme System**: NEVER use hardcoded colors - always use theme variables
- **Formatting**: React components use PascalCase, utilities use camelCase
- **Quotes**: Use double quotes (") per ESLint config
- **Documentation**: Provide JSDoc comments for all functions, components, and complex variables
- **Components**: Components should focus on player-facing features (not DM tools)
- **Firebase**: Always use service classes from BaseFirebaseService

### Post-Restructuring Standards (PLANNED)
- **Feature Organization**: Each feature contains components/, hooks/, context/, services/, types/, pages/
- **Public APIs**: Features export clean interfaces via index.ts barrel exports
- **Import Restrictions**: Features can import from shared/, core/, and other features' public barrels (index.ts); shared/ can import from core/ and features' public barrels the same way — never another domain's internals
- **Domain Boundaries**: Campaign entities grouped together, clear separation from storytelling/collaboration
- **Service Pattern**: All integrations extend BaseFirebaseService singleton pattern
- **Testing Requirements**: All business logic requires tests before implementation

## Project Purpose
This is a tool for tabletop RPG players (not DMs) to collect and organize their shared campaign data including stories, rumors, NPCs, locations, and quests.

## Development Principles
- Follow KISS (Keep It Simple, Stupid): Write straightforward, uncomplicated solutions
- Apply YAGNI (You Aren't Gonna Need It): Don't add speculative features
- Adhere to SOLID Principles
- Maintain DRY (Don't Repeat Yourself): Avoid code duplication

## Architecture

### Current Architecture (Feature-First with Shared Infrastructure)

This is now the actual tree, not a target. The old functional layout is gone.

```
src/
├── app/                      # Composition root: App.tsx + layout shell
│   └── layout/               #   Layout, Header, Footer, Navigation
├── features/                 # Four domains, each behind a barrel index.ts
│   ├── campaign-entities/    #   NPCs, Quests, Locations, Rumors + relationship logic
│   ├── storytelling/         #   Chapters, Stories, Sagas
│   ├── collaboration/        #   Notes, AI entity extraction, AI usage tracking
│   └── user-management/      #   Auth, Groups, Profiles, Admin
├── pages/                    # Route components
│   └── layouts/              #   Dashboard + journal layouts (aggregate several domains)
├── shared/                   # Cross-domain code owned by no single feature
│   ├── components/           #   incl. Breadcrumb, ContextSwitcher, AttributionInfo
│   ├── context/              #   Navigation, Search
│   ├── hooks/                #   useFirebaseData, useNavigation, useSearch
│   └── utils/
├── core/                     # Infrastructure — depends on nothing internal
│   ├── components/           #   UI primitives: Button, Card, Dialog, Input, Typography, Roster
│   ├── services/             #   Firebase (auth/user/group/campaign/data), search, openai
│   ├── types/                #   common, search, user
│   ├── attribution/          #   the single place attribution values are built
│   ├── themes/               #   incl. css/ and definitions/
│   ├── config/
│   └── constants/
├── test-utils/               # Test infrastructure — never bundled
├── utils/__dev__/            # Sample-data tooling; scripts/manage-dev-data.ps1 depends on it
├── styles/
├── index.tsx
└── setupTests.ts
```

- **State Management**: React Context API providers, now living with the domain they serve
- **Firebase**: access through context hooks like `useAuth()`, `useGroups()`; services come from
  `core/services/firebase`, whose barrel initializes lazily on first use
- **Feature Organization**: each domain owns its components, hooks, context and types, and exposes
  them through a single barrel

### Dependency Rules (POST-RESTRUCTURING)
- `app/` → anything (`features/`, `shared/`, `core/`, `pages/`) — it's the composition root
- `pages/` → other features' **public barrels**, `shared/`, `core/`
- `features/` → `shared/`, `core/`, and other features' **public barrels** (never another feature's internals)
- `shared/` → `core/`, and other features' **public barrels** (never a feature's internals)
- `core/` → nothing internal

**The single invariant behind all five rules**: no area may import another feature's internals —
every cross-feature edge goes through that feature's barrel. `core/` depends on nothing internal at
all; everything above it may depend on `core/` and on features' barrels as needed. That invariant is
what the audit actually checked, and it held: zero cross-domain internals imports found anywhere in
the tree.

### Migration Status
- **Phase**: Restructuring is **complete** (all four domains + the `shared`/`core` pass, Phase 3e). Post-migration bug triage (Phase 4) is **largely complete** — 54 of 61 tracker rows resolved as of 2026-07-28. See `TODO.md` for what remains.
- **Order**: user-management → storytelling → campaign-entities → collaboration. Deliberately sequential; each domain must be green before the next starts. Within collaboration, `notes` had to precede `entity-extraction` for the same reason — extraction imports notes' types and helpers.
- **Per-domain exit criteria**: all tests pass except the documented bug markers, coverage on the migrated domain does not drop, no new bugs introduced by the move itself, and a `migration/<domain>-complete` tag on `main` at merge.
- **Risk Level**: Low-Medium (incremental, with a behavioural test suite as the safety net)

## Testing Strategy (CRITICAL PRE-RESTRUCTURING)

### Testing Philosophy
**CRITICAL**: Tests must define expected behavior and reveal bugs - NOT be modified to pass

#### Core Testing Principles
1. **Specification-Based Testing**: Write tests based on requirements and expected behavior, not current implementation
2. **Let Tests Fail**: If tests fail, they reveal bugs in the codebase that need fixing
3. **Tests as Documentation**: Tests serve as the source of truth for what code should do
4. **No Test Modification**: Never change tests to make them pass - fix the code or document the issue
5. **Bug Discovery**: Failing tests are valuable - they identify problems before restructuring

#### Test-First Approach
- **Write tests based on interfaces and specifications**
- **Let failures reveal auth issues, Firebase config problems, or validation bugs**  
- **Document any failures as potential issues to investigate**
- **Use test failures to improve code quality before major refactoring**

### Current State
- **Testing Infrastructure**: Jest + React Testing Library, **4,229 tests across 185 suites**
- **Coverage**: **91.96% statements / 92.42% lines / 85.77% functions / 84.05% branches**, against a uniform 80% CI floor in `jest.config.ts` (measured 2026-07-31 on `design-handoff/dashboard-1a`)
- **Baseline**: **0 failed / 2 skipped / 4227 passed / 4229 total across 185 suites.** The 2 skips are #901's, closed as testability-only. **Any red is a regression.**
  - The previously recorded baseline of 7 failures — the ID-collision markers #002/#004/#009/#012 in the four `*Context.bugs` suites — is **obsolete**: that cluster was fixed 2026-07-28 and those four suites now pass 29/29. If you find advice anywhere telling you to tolerate reds, check `docs/testing/bug-tracking/README.md` before believing it.
  - Measured on the `design-handoff/dashboard-1a` branch, which is ahead of `main`. On `main` expect roughly 182 suites / 4043 tests, also fully green.
  - To prove "the same suites failed", run the suspect suites alone and match counts against the full run; piping a full run through `tail` discards the earlier failures' names.
- **Firebase Testing**: Emulator integration available but underutilized

#### A failing test is not automatically a bug
Three of the catalogued "bugs" (#013, #014, #300) turned out to be a missing `crypto.randomUUID` in
JSDOM: the tests aborted on the environment error *before reaching any assertion*, so the behaviour
they described was never exercised. They sat in the tracker for a year as deferred architectural
work. When triaging a red test, first establish that it actually executed the code it names — a test
that dies on an environment error is indistinguishable, in a failure count, from one that found a
real defect.

### Required Before Restructuring
1. **Context Layer Testing**: All Firebase contexts (NPC, Quest, Location, Rumor, Story, Note)
2. **Cross-Feature Relationships**: Entity relationship integrity and cascading updates
3. **Critical User Workflows**: End-to-end campaign creation, note-taking, entity extraction
4. **Data Integrity**: Referential consistency, concurrent modifications, error handling
5. **Performance Testing**: Large dataset handling, search functionality, load times

### Testing Priorities
- **Priority 1**: Campaign entity CRUD operations and relationships
- **Priority 2**: Note-taking and AI entity extraction workflows  
- **Priority 3**: User management and group system functionality
- **Priority 4**: Known issues from todo list (StoryContext errors, admin panel issues)
- **Priority 5**: Performance and scalability edge cases

### Implementation Timeline
- **Week 1**: Foundation and core context testing
- **Week 2**: Cross-feature relationships and integration tests
- **Week 3**: Workflows, edge cases, and performance testing
- **Success Criteria**: 90%+ context coverage, 100% relationship coverage, all critical paths tested

## Technology Stack

### Current Core Stack
- **Frontend**: React 18.2.0 with TypeScript, TailwindCSS with custom theme system
- **Backend**: Firebase (Auth, Firestore, Functions, Hosting, Analytics)
- **AI Integration**: OpenAI (`gpt-6-luna`, pinned in the function) for entity extraction with usage tracking
- **Development**: Jest + React Testing Library, ESLint, PowerShell automation scripts
- **Icons**: Lucide React (91+ usages throughout application)

### Planned Advanced Features (Roadmap - See `docs/architecture/migration/deep-dive-feature-enhancements.md`)

#### Rich Content & Editing
- **TipTap Editor**: Replace basic textareas with collaborative rich text editing
- **Tabletop Extensions**: Entity mentions (@NPC_NAME), dice rolling (/roll 1d20+5), stat blocks
- **Real-time Collaboration**: Yjs + WebSocket for live collaborative editing

#### Data Visualization & Analytics  
- **React Flow**: Interactive entity relationship networks and campaign mapping
- **D3.js**: Campaign analytics dashboard, character interaction heatmaps
- **React Chrono**: Campaign timeline and session chronology visualization
- **Leaflet**: Interactive world maps with location markers and quest routes

#### Enhanced Search & Discovery
- **Algolia**: Intelligent multi-index search across all campaign entities
- **Semantic Search**: AI-powered content discovery and plot consistency analysis
- **Advanced Filtering**: Cross-entity search with relevance ranking

#### Third-Party Integrations
- **5e SRD API**: Official spells, monsters, equipment integration
- **Discord API**: Campaign coordination via webhooks and bot commands  
- **Enhanced AI Services**: Multiple AI models for diverse content generation
- **Analytics**: Sentry (error tracking), Mixpanel (user behavior), GA4 (journeys)

### Integration Architecture Pattern
- **Service Classes**: All integrations extend BaseFirebaseService singleton pattern
- **React Hooks**: Consistent loading/error state management (useIntegration pattern)
- **Context Providers**: Hierarchical state management with dependency injection
- **Environment Awareness**: Seamless dev/prod configuration with emulator support

## Development Workflow (UPDATED)

### Pre-Development Requirements
1. **Review Architecture Docs**: Study `docs/architecture/` and `docs/testing/` before starting new features
2. **Check Migration Status**: Verify which domains have been migrated in restructuring strategy
3. **Run Test Suite**: Ensure all tests pass before making changes
4. **Validate Environment**: Confirm Firebase emulators and dependencies are working

### Feature Development Process (CURRENT STRUCTURE)
1. **Impact Assessment**: Determine if feature should wait for post-restructuring implementation
2. **Context Integration**: Use existing context providers and service classes
3. **Component Organization**: Follow current directory structure (components/features/)
4. **Cross-Feature Dependencies**: Document any dependencies for restructuring consideration
5. **Testing Requirements**: Add tests for new business logic (prepare for restructuring)

### Feature Development Process (POST-RESTRUCTURING)
1. **Domain Assignment**: Determine which feature domain your change belongs to
2. **Public API Design**: Plan how your feature will expose functionality via index.ts
3. **Import Restrictions**: Use shared/ and core/ only - never direct feature imports
4. **Service Pattern**: Extend BaseFirebaseService for new integrations
5. **Testing Requirements**: Comprehensive test coverage for all business logic

### Integration Development Guidelines
1. **Service Architecture**: Follow BaseFirebaseService extension pattern
2. **Environment Configuration**: Support both development and production setups
3. **Error Handling**: Implement circuit breakers and graceful degradation
4. **Rate Limiting**: Respect third-party API limits and implement usage tracking
5. **Security**: Never expose API keys in frontend code - use Firebase Functions

### Emergency Fixes During Migration
- **Small Fixes**: Can be applied to current structure with caution
- **Large Features**: Should wait for post-restructuring implementation
- **Bug Fixes**: Prioritize fixing in current structure, plan migration
- **Critical Issues**: May require temporary workarounds during migration phases