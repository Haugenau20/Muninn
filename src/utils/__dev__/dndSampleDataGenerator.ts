// src/utils/__dev__/dndSampleDataGenerator.ts

import { initializeApp } from 'firebase/app';
import { getFirestore, connectFirestoreEmulator } from 'firebase/firestore';
import { getAuth, connectAuthEmulator } from 'firebase/auth';
import * as dotenv from 'dotenv';
import { 
  createSampleUsers, 
  createUserProfiles, 
  createGroups, 
  addUsersToGroups,
  generateContentForCampaign,
  SAMPLE_CAMPAIGNS
} from './generators';
dotenv.config();

// Initialize Firebase with emulator configuration
const initEmulatorConnection = () => {
  const firebaseConfig = {
    apiKey: process.env.REACT_APP_API_KEY,
    authDomain: process.env.REACT_APP_AUTH_DOMAIN,
    projectId: process.env.REACT_APP_PROJECT_ID,
    storageBucket: process.env.REACT_APP_STORAGE_BUCKET,
    messagingSenderId: process.env.REACT_APP_MESSAGING_SENDER_ID,
    appId: process.env.REACT_APP_APP_ID
  };

  const app = initializeApp(firebaseConfig);
  const db = getFirestore(app);
  const auth = getAuth(app);

  // Connect to emulators
  const host = process.env.REACT_APP_EMULATOR_HOST || 'localhost';
  connectFirestoreEmulator(db, host, 8080);
  connectAuthEmulator(auth, `http://${host}:9099`);

  return { db, auth };
};

// Main function to generate sample data
export const generateSampleData = async () => {
  console.log('Starting sample data generation for Muninn...');
  
  try {
    const { db, auth } = initEmulatorConnection();
    const now = new Date();
    const formattedDate = now.toISOString();
    
    // Step 1: Create all users
    console.log('Step 1: Creating users...');
    const { users, userMapping } = await createSampleUsers(auth);
    
    // Step 2: Create user profiles
    console.log('Step 2: Creating user profiles...');
    await createUserProfiles(db, users);
    
    // Step 3: Create groups
    console.log('Step 3: Creating groups...');
    const { group1Id, group2Id } = await createGroups(db, userMapping);
    
    // Step 4: Add users to groups with appropriate roles
    console.log('Step 4: Adding users to groups...');
    await addUsersToGroups(db, users, { group1Id, group2Id }, formattedDate);
    
    // Step 5: Create each campaign and everything in it
    console.log('Step 5: Creating campaigns and their content...');
    for (const campaign of SAMPLE_CAMPAIGNS) {
      await generateContentForCampaign(db, campaign, userMapping, now);
    }
    
    console.log('Sample data generation complete!');
  } catch (error) {
    console.error('Error generating sample data:', error);
    // Rethrown: swallowed, a failed run resolved, and the entry point
    // announced a complete dataset and exited 0 (T100, OPS-003).
    throw error;
  }
};

// Run the generator when called directly
if (require.main === module) {
  generateSampleData().catch(() => process.exit(1));
}