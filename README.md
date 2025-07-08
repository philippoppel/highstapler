# TrustMust - Interactive Multiplayer Quiz Game

TrustMust is a real-time multiplayer quiz game where players can challenge each other, answer questions, and compete for the highest score. Built with React, Node.js, and Socket.IO, it offers a seamless and interactive gaming experience.

## 🎮 Features

- **Real-time Multiplayer**: Play with friends in real-time with WebSocket connections
- **Role-based Gameplay**: Play as either a Challenger or Moderator
- **Interactive UI**: Beautiful and responsive interface with smooth animations
- **Score Tracking**: Keep track of scores and game progress
- **Auto-reconnect**: Automatically reconnects if connection is lost
- **Mobile-friendly**: Responsive design works on all devices

## 🚀 Getting Started

### Prerequisites

- Node.js (v14 or higher)
- npm (comes with Node.js)

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/philippoppel/highstapler.git
   cd highstapler
   ```

2. Install server dependencies:
   ```bash
   npm install
   ```

3. Install client dependencies:
   ```bash
   cd quiz-game-client
   npm install
   cd ..
   ```

### Configuration

Create a `.env` file in the root directory with the following variables:

```
NEXT_PUBLIC_SOCKET_URL=http://localhost:3001
PORT=3001
```

### Running the Application

1. Start the server (from the root directory):
   ```bash
   npm run dev
   ```

2. In a new terminal, start the client:
   ```bash
   cd quiz-game-client
   npm run dev
   ```

3. Open your browser and navigate to `http://localhost:3000`

## 🎯 How to Play

1. **Create a Game**: Click "Create Game" to start a new game session
2. **Share Game ID**: Share the generated Game ID with your friend
3. **Join Game**: The second player enters the Game ID and their name
4. **Select Roles**: Choose to be the Challenger or Moderator
5. **Play!**: Answer questions and compete for the highest score

## 🛠️ Tech Stack

- **Frontend**: React, Tailwind CSS, Lucide Icons
- **Backend**: Node.js, Express
- **Real-time**: Socket.IO
- **Package Manager**: npm

## 📂 Project Structure

```
├── server.js           # Express server setup
├── quiz-game-client/   # React frontend
│   ├── src/
│   │   ├── App.jsx    # Main game component
│   │   └── ...        # Other React components
├── package.json        # Server dependencies
└── .env               # Environment variables
```

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## 📄 License

This project is licensed under the ISC License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- Thanks to all contributors who have helped with this project!
- Special thanks to the open-source community for the amazing tools and libraries used in this project.
