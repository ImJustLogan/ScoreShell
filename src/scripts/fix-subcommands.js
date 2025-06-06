const fs = require('fs');
const path = require('path');

const SUBCOMMANDS_DIR = path.join(__dirname, '../commands/club/subcommands');

// Read all subcommand files
const subcommandFiles = fs.readdirSync(SUBCOMMANDS_DIR)
    .filter(file => file.endsWith('.js'));

for (const file of subcommandFiles) {
    const filePath = path.join(SUBCOMMANDS_DIR, file);
    let content = fs.readFileSync(filePath, 'utf8');

    // Remove SlashCommandBuilder import if it exists
    content = content.replace(/const\s*{\s*SlashCommandBuilder\s*}\s*=\s*require\(['"]@discordjs\/builders['"]\);\n?/g, '');

    // Remove command registration
    content = content.replace(/data:\s*new\s*SlashCommandBuilder\(\)[\s\S]*?\),\s*\n\s*async\s*execute/g, 'async execute');

    // Update execute function to accept shared constants
    content = content.replace(/async\s*execute\s*\(\s*interaction\s*\)/g, 'async execute(interaction, { CLUB_ICONS, PRIVACY_TYPES })');

    // Write the modified content back
    fs.writeFileSync(filePath, content);
    console.log(`Fixed ${file}`);
}

console.log('All subcommand files have been fixed!'); 