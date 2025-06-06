# ScoreShell Bot

A comprehensive Discord bot for Mario Super Sluggers competitive play, featuring ranked matches, clubs, challenges, and more.

## Features

- **Ranked System**: Complete ranked ladder with 7 ranks (Bronze to Masters)
- **Club System**: Create and manage clubs with leagues and tournaments
- **Challenge System**: Participate in various challenges with unique rules
- **Bingo Mode**: Special game mode with bingo cards
- **Admin Tools**: Comprehensive moderation and administration tools
- **Player Profiles**: Detailed player cards with badges and statistics
- **Leaderboards**: Global and club-specific leaderboards
- **Matchmaking**: Intelligent queue system with proper matchmaking

## Setup

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```
3. Copy `.env.example` to `.env` and fill in your values:
   ```bash
   cp .env.example .env
   ```
4. Set up MongoDB database
5. Start the bot:
   ```bash
   npm start
   ```

## Development

- `npm run dev` - Start bot with nodemon for development
- `npm run lint` - Run ESLint
- `npm test` - Run tests

## Project Structure

```
scoreshell-bot/
├── src/
│   ├── commands/        # Slash commands
│   ├── events/          # Discord event handlers
│   ├── models/          # Database models
│   ├── services/        # Business logic
│   ├── utils/           # Utility functions
│   ├── config/          # Configuration
│   └── index.js         # Entry point
├── tests/               # Test files
├── .env.example         # Environment template
├── .gitignore          # Git ignore file
├── package.json        # Project dependencies
└── README.md           # This file
```

## Contributing

1. Fork the repository
2. Create your feature branch
3. Commit your changes
4. Push to the branch
5. Create a Pull Request

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Support

For support, please join our Discord server or open an issue on GitHub. 