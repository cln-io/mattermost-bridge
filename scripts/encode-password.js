#!/usr/bin/env node

/**
 * Helper script to encode passwords to base64 for the .env file
 * 
 * Usage:
 *   node scripts/encode-password.js "mypassword123"
 *   node scripts/encode-password.js
 */

const readline = require('readline');

function encodePassword(password) {
  return Buffer.from(password).toString('base64');
}

function main() {
  const args = process.argv.slice(2);
  
  if (args.length > 0) {
    // Password provided as argument
    const password = args[0];
    const encoded = encodePassword(password);
    
    console.log(`Password: ${password}`);
    console.log(`Base64:   ${encoded}`);
    console.log(`\nAdd to your .env file:`);
    console.log(`MATTERMOST_LEFT_PASSWORD_B64=${encoded}`);
    console.log(`MATTERMOST_RIGHT_PASSWORD_B64=${encoded}`);
    
  } else {
    // Interactive mode
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    
    console.log('🔐 Password Encoder for Mattermost Bridge');
    console.log('==========================================\n');
    
    rl.question('Enter password to encode: ', (password) => {
      if (!password) {
        console.log('❌ No password provided');
        rl.close();
        return;
      }
      
      const encoded = encodePassword(password);
      
      console.log(`\n✅ Password encoded successfully!`);
      console.log(`Original:  ${password}`);
      console.log(`Base64:    ${encoded}`);
      console.log(`\n📋 Add to your .env file:`);
      console.log(`MATTERMOST_LEFT_PASSWORD_B64=${encoded}`);
      console.log(`MATTERMOST_RIGHT_PASSWORD_B64=${encoded}`);
      console.log('\n💡 Tip: Delete your terminal history after running this script for security');
      
      rl.close();
    });
  }
}

if (require.main === module) {
  main();
}