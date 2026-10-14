// src/utils/__dev__/generateSampleData.ts

import { generateSampleData } from "./dndSampleDataGenerator";

console.log('=== Muninn Sample Data Generator ===');
console.log('This will populate your Firebase emulator with interconnected sample data');
console.log('including 2 groups, 4 campaigns, users, NPCs, locations, quests, rumors, etc.');
console.log('Make sure your emulators are running first!');
console.log('');

generateSampleData()
  .then(() => {
    console.log('Sample data generation completed successfully!');
    console.log('Generated:');
    console.log('- 10 users: 2 in both groups, 1 in none');
    console.log('- 2 groups with appropriate user memberships');
    console.log('- 2 campaigns per group (4 total)');
    console.log('- Campaign content including chapters, NPCs, locations, quests, and rumors');
    console.log('You can now access this data in your development environment.');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Failed to generate sample data:', error);
    process.exit(1);
  });