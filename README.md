# Agent Trinity Platform

A comprehensive multi-agent platform built with Next.js 15, TypeScript, and Venice.ai integration. This platform enables the creation of specialized AI agents for skill development, code generation, and integration explanation.

## 🚀 Quick Start

```bash
# Install dependencies
pnpm install

# Set up environment variables
cp .env.example .env
# Edit .env with your actual values

# Run database migrations
pnpm db:migrate

# Seed the database
pnpm db:seed

# Start development server
pnpm dev
```

## 🧩 Agent Structure

This platform includes three specialized agents:

1. **Integration Explainer (Agent 3)**: Explains integration patterns, security, and performance optimization
2. **SkillMarkdown Architect (Agent 1)**: Generates optimized skill markdown files for Venice.ai's context system
3. **VSCode Agent Generator (Agent 2)**: Creates production-ready agent code for VS Code with your specified stack

## 🛠️ Development Workflow

### Adding New Stack Components

1. Update the `stack-integration.md` file in `agent3-integration-explainer/patterns/`
2. Add new tools to `agent3-integration-explainer/tools/`
3. Update the integration patterns in `agent3-integration-explainer/patterns/`
4. Create new skill templates in `agent1-skillmarkdown-architect/skills/`

### Running Tests

```bash
# Run unit tests
pnpm test:unit

# Run integration tests
pnpm test:integration

# Run all tests
pnpm test

# Run e2e tests
pnpm test:e2e
```

## 📊 Monitoring & Metrics

The platform includes comprehensive monitoring:

- Performance metrics collection
- Security alerting
- Database query tracking
- Cache efficiency monitoring
- API response time analysis

## 📦 Deployment

### Vercel Deployment

1. Connect your GitHub repository to Vercel
2. Set up environment variables in Vercel dashboard
3. Deploy with `pnpm deploy:staging` or `pnpm deploy:production`

### Docker Deployment

```bash
# Build the Docker image
pnpm build:docker

# Run the container
docker run -p 3000:3000 agent-trinity-platform
```

## 🔒 Security

- All API keys are stored in environment variables
- JWT tokens are encrypted at rest
- CORS policies are configured securely
- Rate limiting is implemented at the API level
- All sensitive data is masked in logs

## 🤝 Contributing

Check the [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines on how to contribute to this project.

## 📚 Documentation

- [Agent 3: Integration Explainer](agent3-integration-explainer/README.md)
- [Agent 1: SkillMarkdown Architect](agent1-skillmarkdown-architect/README.md)
- [Agent 2: VSCode Agent Generator](agent2-vscode-agent-generator/README.md)
- [Performance Monitoring](performance-monitoring/README.md)
- [Security Guidelines](security/README.md)
