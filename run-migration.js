const { PrismaClient } = require('@prisma/client');
const fs = require('fs');

const prisma = new PrismaClient();

async function runMigration() {
  try {
    console.log('🔄 Starting manual migration...');

    // Read the SQL file
    const sql = fs.readFileSync('./manual_migration.sql', 'utf-8');
    
    // Split SQL commands (basic splitting by semicolon)
    const commands = sql
      .split(';')
      .map(cmd => cmd.trim())
      .filter(cmd => cmd.length > 0 && !cmd.startsWith('--'));

    // Execute each command
    for (let i = 0; i < commands.length; i++) {
      const command = commands[i];
      if (command.includes('SELECT') || command.length < 10) {
        console.log(`⏭️  Skipping verification query ${i + 1}`);
        continue;
      }
      
      console.log(`⚙️  Executing command ${i + 1}...`);
      try {
        await prisma.$executeRawUnsafe(command);
        console.log(`✅ Command ${i + 1} executed successfully`);
      } catch (error) {
        if (error.message.includes('already exists')) {
          console.log(`⚠️  Command ${i + 1} - Object already exists, skipping...`);
        } else {
          throw error;
        }
      }
    }

    console.log('\n✅ Migration completed successfully!');
    
    // Verify the migration
    console.log('\n🔍 Verifying migration...');
    
    const offersTable = await prisma.$queryRaw`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_name = 'offers'
    `;
    
    const priceColumn = await prisma.$queryRaw`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'posts' AND column_name = 'price'
    `;
    
    if (offersTable.length > 0) {
      console.log('✅ offers table created');
    } else {
      console.log('❌ offers table NOT found');
    }
    
    if (priceColumn.length > 0) {
      console.log('✅ price column added to posts');
    } else {
      console.log('❌ price column NOT found in posts');
    }
    
  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

runMigration()
  .then(() => {
    console.log('\n🎉 Done!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n💥 Error:', error);
    process.exit(1);
  });
