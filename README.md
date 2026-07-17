# Contractor CMS

A simple customer management system for contractors to manage their clients and projects.

## Features

- **Dashboard**: Overview of clients, projects, and key metrics
- **Client Management**: Create, view, and manage client information
- **Project Tracking**: Organize projects by client with status tracking
- **Simple & Customizable**: Built with Vue.js + Vite for easy customization and fast development

## Tech Stack

- **Frontend**: Vue.js 3 + Vite
- **Backend**: Node.js + Express
- **Database**: SQLite

## Getting Started

### Prerequisites

- Node.js (v14 or higher)
- npm

### Installation

1. Clone the repository:
```bash
git clone https://github.com/robot297/cms-contractor.git
cd cms-contractor
```

2. Install dependencies:
```bash
npm install
```

3. Create the data directory:
```bash
mkdir data
```

### Development

Run both frontend (Vite) and backend (Express) in development mode:
```bash
npm run dev
```

This will:
- Start Vite dev server on `http://localhost:5173` with hot module replacement (HMR)
- Start Express server on `http://localhost:3000`
- Proxy API calls from frontend to backend

### Production

Build and start the production server:
```bash
npm start
```

This will:
- Build the Vue.js frontend with Vite
- Serve the production build from Express on `http://localhost:3000`

## Project Structure

```
.
├── server.js           # Express server & API routes
├── package.json        # Dependencies
├── vite.config.js      # Vite configuration
├── index.html          # Main HTML file
├── src/
│   ├── main.js        # Vue app entry point
│   ├── App.vue        # Root Vue component
│   └── style.css      # Global styles
├── dist/              # Built frontend (production)
├── data/              # SQLite database
└── README.md          # This file
```

## Usage

### Dashboard
See a quick overview of your business:
- Total number of clients
- Active and completed projects
- Recent project activity

### Clients
- Add new clients with contact info and hourly rates
- View all clients in a grid layout
- Manage client information

### Projects
- Create projects and link them to clients
- Track project status (Not Started, In Progress, Completed)
- Set project dates

## Development Benefits with Vite

- ⚡ **Instant HMR**: See changes instantly while developing
- 🚀 **Fast Build**: Lightning-quick production builds
- 📦 **Optimized Output**: Smaller bundle sizes
- 🔧 **Easy Customization**: Modify components, styles, and logic instantly

## Future Enhancements

- Time tracking for billable hours
- Invoice generation
- Payment status tracking
- Notes and communication history
- Export reports

## License

MIT
