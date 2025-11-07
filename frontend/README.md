# Job Server Dashboard

A modern React frontend built with Next.js 14 and shadcn/ui for observability and management of the Job Server system.

## Features

- **Dashboard**: Overview with metrics, status distribution, and throughput charts
- **Job Management**: List, search, filter, and cancel jobs with detailed views
- **Dead Letter Queue**: Manage and retry failed jobs
- **Job Definitions Analytics**: Performance metrics by job definition
- **Real-time Updates**: Auto-refresh every 30 seconds
- **Dark/Light Mode**: Theme toggle with system preference support
- **Responsive Design**: Mobile-friendly interface
- **Bubblegum Theme**: Beautiful color scheme with soft shadows

## Tech Stack

- **Framework**: Next.js 14 with TypeScript
- **UI Components**: shadcn/ui with Radix primitives
- **Styling**: Tailwind CSS with bubblegum theme
- **Charts**: Recharts for data visualization
- **Icons**: Lucide React
- **Fonts**: Poppins, Lora, Fira Code (Google Fonts)

## Getting Started

### Prerequisites

- Node.js 18+ and npm
- Job Server API running (default: http://localhost:3000)

### Installation

1. Install dependencies:
```bash
npm install
```

2. Configure environment variables:
```bash
cp .env.local.example .env.local
# Edit .env.local with your job server API URL
```

3. Start the development server:
```bash
npm run dev
```

4. Open [http://localhost:3001](http://localhost:3001) in your browser

### Environment Variables

- `NEXT_PUBLIC_API_URL`: Job Server API URL (default: http://localhost:3000)

## Project Structure

```
src/
├── app/                    # Next.js app directory
│   ├── page.tsx           # Dashboard page
│   ├── jobs/              # Job management
│   ├── dlq/               # Dead letter queue
│   └── definitions/       # Job definitions analytics
├── components/
│   ├── charts/            # Chart components
│   ├── job/               # Job-related components
│   ├── layout/            # Navigation and layout
│   ├── metrics/           # Metric display components
│   └── ui/                # shadcn/ui components
├── lib/
│   ├── api.ts             # API client
│   └── utils.ts           # Utilities
└── types/
    └── api.ts             # TypeScript types
```

## API Integration

The dashboard connects to the Job Server REST API endpoints:

- `GET /v1/metrics` - Overall metrics
- `GET /v1/metrics/definitions` - Per-definition metrics
- `GET /v1/metrics/throughput` - Time-series data
- `GET /v1/jobs` - Job listing
- `GET /v1/jobs/:id` - Job details
- `POST /v1/jobs/:id/cancel` - Cancel job
- `GET /v1/jobs/:id/events` - Job events
- `GET /v1/dlq` - Dead letter queue
- `POST /v1/dlq/:id/retry` - Retry failed job

## Features Overview

### Dashboard
- Real-time metrics cards (total jobs, success rate, processing times)
- Job status pie chart
- Throughput timeline chart
- Performance statistics

### Jobs Page
- Searchable job table with filters
- Job status badges with color coding
- Detailed job view with events timeline
- Cancel job functionality
- Auto-refresh capabilities

### Dead Letter Queue
- Failed job management
- Retry functionality with configurable attempts
- Error analysis and debugging
- Job parameter inspection

### Job Definitions Analytics
- Performance comparison charts
- Top/bottom performer identification
- Detailed metrics table
- Success rate analysis

## Development

### Available Scripts

- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm run start` - Start production server
- `npm run lint` - Run ESLint

### Adding New Components

The project uses shadcn/ui components. To add new components:

```bash
npx shadcn@latest add [component-name]
```

### Theme Customization

The bubblegum theme is configured in `src/app/globals.css`. Colors and styling can be customized by modifying the CSS custom properties.

## Deployment

1. Build the project:
```bash
npm run build
```

2. Start the production server:
```bash
npm run start
```

Or deploy to Vercel, Netlify, or your preferred hosting platform.

## Contributing

1. Follow the existing code style and patterns
2. Use TypeScript for type safety
3. Maintain responsive design principles
4. Test across light/dark themes
5. Ensure API error handling is comprehensive