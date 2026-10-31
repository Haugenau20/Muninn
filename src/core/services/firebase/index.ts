// src/core/services/firebase/index.ts
import { firebaseConfig } from './config/firebaseConfig';
import ServiceRegistry from './core/ServiceRegistry';
import AuthService from './auth/AuthService';
import UserService from './user/UserService';
import GroupService from './group/GroupService';
import InvitationService from './group/InvitationService';
import CampaignService from './campaign/CampaignService';
import DocumentService from './data/DocumentService';
import ImageStorageService from './storage/ImageStorageService';

/**
 * The set of Firebase-backed services this module exposes.
 */
export interface FirebaseServices {
  auth: AuthService;
  user: UserService;
  group: GroupService;
  invitation: InvitationService;
  campaign: CampaignService;
  document: DocumentService;
  images: ImageStorageService;
}

/** Memoized bundle; populated on first use, never at module scope. */
let instances: FirebaseServices | null = null;

/**
 * Construct every service and register it, in dependency order.
 *
 * Constructing the first service initializes the Firebase app itself, via
 * BaseFirebaseService. That is why this
 * must never run at module scope: any barrel with a transitive path to this
 * file would otherwise initialize Firebase on import and fail under jsdom.
 */
function initializeFirebaseServices(): FirebaseServices {
  const registry = ServiceRegistry.getInstance();

  // Initialize services in dependency order
  const userService = UserService.getInstance();
  registry.register('userService', userService);

  const groupService = GroupService.getInstance();
  registry.register('groupService', groupService);

  const authService = AuthService.getInstance();
  registry.register('authService', authService);

  const invitationService = InvitationService.getInstance();
  registry.register('invitationService', invitationService);

  const campaignService = CampaignService.getInstance();
  registry.register('campaignService', campaignService);

  const documentService = DocumentService.getInstance();
  registry.register('documentService', documentService);

  // Not 'storage': that registry key holds the FirebaseStorage instance itself.
  const imageStorageService = ImageStorageService.getInstance();
  registry.register('imageStorageService', imageStorageService);

  return {
    auth: authService,
    user: userService,
    group: groupService,
    invitation: invitationService,
    campaign: campaignService,
    document: documentService,
    images: imageStorageService
  };
}

/**
 * Resolve the service bundle, initializing Firebase on first call.
 * Prefer this over the exported constants when you want the initialization
 * point to be explicit.
 */
export function getFirebaseServices(): FirebaseServices {
  if (!instances) {
    instances = initializeFirebaseServices();
  }
  return instances;
}

/**
 * Build a stand-in for a service that defers construction until one of its
 * members is actually read. This keeps importing this module side-effect free
 * while preserving the historical `firebaseServices.auth.someMethod()` shape.
 *
 * Methods are bound to the real instance so private/protected fields resolve
 * correctly when called through the stand-in.
 */
function lazyService<K extends keyof FirebaseServices>(key: K): FirebaseServices[K] {
  const resolve = () => getFirebaseServices()[key] as unknown as Record<PropertyKey, unknown>;

  return new Proxy({} as Record<PropertyKey, unknown>, {
    get(_target, prop) {
      const service = resolve();
      const value = service[prop];
      return typeof value === 'function' ? value.bind(service) : value;
    },
    set(_target, prop, value) {
      resolve()[prop] = value;
      return true;
    },
    has(_target, prop) {
      return prop in resolve();
    },
    getPrototypeOf() {
      return Object.getPrototypeOf(resolve());
    }
  }) as unknown as FirebaseServices[K];
}

// Individual services, for direct access if needed. These are lazy stand-ins:
// holding a reference costs nothing, reading a member initializes Firebase.
export const auth = lazyService('auth');
export const user = lazyService('user');
export const group = lazyService('group');
export const invitation = lazyService('invitation');
export const campaign = lazyService('campaign');
export const document = lazyService('document');
export const images = lazyService('images');

/**
 * Firebase services API
 */
const firebaseServices: FirebaseServices = {
  auth,
  user,
  group,
  invitation,
  campaign,
  document,
  images
};

export default firebaseServices;
export { firebaseConfig };
export {
  entityImagePrefix,
  privateEntityImagePrefix,
  crestPrefix,
  isOwnBucketUrl
} from './storage/ImageStorageService';
export type { ImageEntityType } from './storage/ImageStorageService';
