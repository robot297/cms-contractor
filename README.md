# Contractor CMS

A simple customer management system for contractors to manage their clients and projects.

## Features

- **Dashboard**: Overview of clients, projects, and key metrics
- **Client Management**: Create, view, and manage client information
- **Project Tracking**: Organize projects by client with status tracking
- **Simple & Customizable**: Built with Vue.js for easy customization

## Tech Stack

- **Frontend**: Vue.js 3
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

4. Start the server:
```bash
npm start
```

5. Open your browser and navigate to:
```
http://localhost:3000
```

### Development

For development with auto-reload:
```bash
npm run dev
```

## Project Structure

```
.
├── server.js           # Express server & API routes
├── package.json        # Dependencies
├── public/
│   ├── index.html      # Main HTML file
│   ├── app.js          # Vue.js application
│   └── styles.css      # Styling
├── data/               # SQLite database (created on first run)
└── README.md           # This file
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

## Future Enhancements

- Time tracking for billable hours
- Invoice generation
- Payment status tracking
- Notes and communication history
- Export reports

## License

MIT
