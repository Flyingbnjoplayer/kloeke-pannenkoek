
# FILE 9: TESTING STRATEGY & QUALITY ASSURANCE
**Location:** `~/.venice/agent-trinity/integration-explainer/testing-strategy.md`

## 1. TESTING PHILOSOPHY & APPROACH

### 1.1 Testing Pyramid
```
Unit Tests (70%)
├── Fast (<100ms each)
├── Isolated (no external dependencies)
├── Run on every commit
└── Coverage target: 80%+

Integration Tests (20%)
├── Medium speed (1-5s each)
├── Test component interactions
├── Run on PR merges
└── Coverage target: 70%+

E2E Tests (10%)
├── Slow (5-30s each)
├── Test user journeys
├── Run nightly in CI
└── Coverage target: 50%+
```

### 1.2 Testing Principles
- **Test First Development:** Write tests before implementation
- **Isolation:** Tests should not depend on each other
- **Determinism:** Tests should produce same result every time
- **Speed:** Fast feedback loop (complete suite < 10 minutes)
- **Maintainability:** Tests should be easy to understand and modify
- **Reliability:** No flaky tests allowed

### 1.3 Quality Metrics
- **Code Coverage:** 80%+ unit, 70%+ integration, 50%+ E2E
- **Test Speed:** Complete suite < 10 minutes
- **Flaky Tests:** < 1% of test suite
- **Defect Rate:** < 1 bug per 1000 lines of code
- **Test Maintenance:** < 20% of development time

## 2. UNIT TESTING STRATEGY

### 2.1 Testing Framework Setup
```typescript
// vitest.config.ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/**',
        'dist/**',
        '**/*.d.ts',
        '**/*.config.*',
        '**/*.test.*',
        '**/*.spec.*',
        '**/index.ts',
        '**/types.ts',
      ],
      thresholds: {
        statements: 80,
        branches: 70,
        functions: 80,
        lines: 80,
      },
    },
    reporters: ['verbose'],
    outputFile: {
      json: './test-results/vitest-results.json',
    },
    testTimeout: 10000,
    hookTimeout: 10000,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
```

### 2.2 Unit Test Structure
```typescript
// tests/unit/components/Button.test.tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { Button } from '@/components/ui/button';

describe('Button Component', () => {
  // Test 1: Rendering
  it('renders button with correct text', () => {
    render(<Button>Click me</Button>);
    expect(screen.getByRole('button', { name: /click me/i })).toBeInTheDocument();
  });

  // Test 2: Props
  it('applies variant classes correctly', () => {
    const { container } = render(<Button variant="destructive">Delete</Button>);
    expect(container.firstChild).toHaveClass('bg-destructive');
  });

  // Test 3: Events
  it('calls onClick handler when clicked', () => {
    const handleClick = vi.fn();
    render(<Button onClick={handleClick}>Click me</Button>);
    fireEvent.click(screen.getByRole('button'));
    expect(handleClick).toHaveBeenCalledTimes(1);
  });

  // Test 4: Accessibility
  it('has proper aria attributes when loading', () => {
    render(<Button isLoading>Loading</Button>);
    const button = screen.getByRole('button');
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(button).toHaveAttribute('aria-label', 'Loading');
  });

  // Test 5: Snapshot
  it('matches snapshot', () => {
    const { container } = render(<Button>Test Button</Button>);
    expect(container.firstChild).toMatchSnapshot();
  });

  // Test 6: Edge Cases
  it('handles disabled state correctly', () => {
    const handleClick = vi.fn();
    render(
      <Button disabled onClick={handleClick}>
        Disabled
      </Button>
    );
    const button = screen.getByRole('button');
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(handleClick).not.toHaveBeenCalled();
  });
});
```

### 2.3 Business Logic Testing
```typescript
// tests/unit/lib/auth.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuthService, TokenPayload } from '@/lib/auth';
import { createMockSupabaseClient } from '../mocks/supabase';

describe('AuthService', () => {
  let authService: AuthService;
  let mockSupabase: any;

  beforeEach(() => {
    mockSupabase = createMockSupabaseClient();
    authService = new AuthService(mockSupabase);
  });

  describe('login', () => {
    it('returns token on successful login', async () => {
      // Arrange
      const credentials = { email: 'test@example.com', password: 'password123' };
      mockSupabase.auth.signInWithPassword.mockResolvedValue({
        data: { user: { id: '123', email: 'test@example.com' }, session: { access_token: 'jwt-token' } },
        error: null,
      });

      // Act
      const result = await authService.login(credentials);

      // Assert
      expect(result.success).toBe(true);
      expect(result.token).toBe('jwt-token');
      expect(mockSupabase.auth.signInWithPassword).toHaveBeenCalledWith(credentials);
    });

    it('returns error on invalid credentials', async () => {
      // Arrange
      const credentials = { email: 'test@example.com', password: 'wrong' };
      mockSupabase.auth.signInWithPassword.mockResolvedValue({
        data: { user: null, session: null },
        error: { message: 'Invalid credentials' },
      });

      // Act
      const result = await authService.login(credentials);

      // Assert
      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid credentials');
    });

    it('handles network errors', async () => {
      // Arrange
      const credentials = { email: 'test@example.com', password: 'password123' };
      mockSupabase.auth.signInWithPassword.mockRejectedValue(new Error('Network error'));

      // Act & Assert
      await expect(authService.login(credentials)).rejects.toThrow('Network error');
    });

    it('validates email format', async () => {
      // Arrange
      const credentials = { email: 'invalid-email', password: 'password123' };

      // Act
      const result = await authService.login(credentials);

      // Assert
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid email format');
    });
  });

  describe('validateToken', () => {
    it('returns decoded payload for valid token', async () => {
      // Arrange
      const validToken = 'valid.jwt.token';
      const mockPayload: TokenPayload = { sub: '123', email: 'test@example.com', exp: Date.now() / 1000 + 3600 };

      // Act
      const result = await authService.validateToken(validToken);

      // Assert
      expect(result.valid).toBe(true);
      expect(result.payload).toEqual(mockPayload);
    });

    it('returns error for expired token', async () => {
      // Arrange
      const expiredToken = 'expired.jwt.token';
      const mockPayload: TokenPayload = { sub: '123', email: 'test@example.com', exp: Date.now() / 1000 - 3600 };

      // Act
      const result = await authService.validateToken(expiredToken);

      // Assert
      expect(result.valid).toBe(false);
      expect(result.error).toBe('Token expired');
    });

    it('returns error for invalid token', async () => {
      // Act
      const result = await authService.validateToken('invalid.token');

      // Assert
      expect(result.valid).toBe(false);
      expect(result.error).toBe('Invalid token');
    });
  });
});
```

### 2.4 Component Testing Patterns
```typescript
// tests/patterns/component-testing.ts
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Pattern 1: Testing user interactions
export async function testUserInteraction(component: React.ReactElement, interactions: Array<{
  action: () => Promise<void> | void;
  assertion: () => void;
}>) {
  render(component);
  for (const { action, assertion } of interactions) {
    await action();
    assertion();
  }
}

// Pattern 2: Testing loading states
export function testLoadingState(component: React.ReactElement, loadingText?: string) {
  render(component);
  if (loadingText) {
    expect(screen.getByText(loadingText)).toBeInTheDocument();
  } else {
    expect(screen.getByRole('status')).toBeInTheDocument();
  }
}

// Pattern 3: Testing error states
export function testErrorState(component: React.ReactElement, errorMessage: string) {
  render(component);
  expect(screen.getByText(errorMessage)).toBeInTheDocument();
  expect(screen.getByRole('alert')).toBeInTheDocument();
}

// Pattern 4: Testing form submissions
export async function testFormSubmission(
  component: React.ReactElement,
  formData: Record<string, string>,
  submitButtonText?: string
) {
  render(component);
  
  // Fill form
  for (const [name, value] of Object.entries(formData)) {
    const input = screen.getByLabelText(new RegExp(name, 'i')) || screen.getByPlaceholderText(name);
    await userEvent.type(input, value);
  }
  
  // Submit
  const submitButton = screen.getByRole('button', { name: submitButtonText || /submit/i });
  await userEvent.click(submitButton);
  
  // Wait for submission to complete
  await waitFor(() => {
    expect(submitButton).toBeEnabled();
  });
}
```

## 3. INTEGRATION TESTING STRATEGY

### 3.1 API Integration Testing
```typescript
// tests/integration/api/conversations.test.ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createTestClient } from '../utils/test-client';
import { testDataFactory } from '../factories';

describe('Conversations API', () => {
  let client: ReturnType<typeof createTestClient>;
  let authToken: string;
  let testUser: any;

  beforeAll(async () => {
    client = createTestClient();
    testUser = await testDataFactory.createUser();
    authToken = await client.auth.login(testUser.email, 'password123');
  });

  afterAll(async () => {
    await testDataFactory.cleanupDatabase();
  });

  beforeEach(async () => {
    await testDataFactory.clearConversations();
  });

  describe('GET /api/conversations', () => {
    it('returns empty array when no conversations exist', async () => {
      const response = await client.get('/api/conversations', authToken);
      
      expect(response.status).toBe(200);
      expect(response.data).toEqual([]);
    });

    it('returns user conversations', async () => {
      // Arrange
      const conversation = await testDataFactory.createConversation({
        userId: testUser.id,
        title: 'Test Conversation',
      });

      // Act
      const response = await client.get('/api/conversations', authToken);

      // Assert
      expect(response.status).toBe(200);
      expect(response.data).toHaveLength(1);
      expect(response.data[0]).toMatchObject({
        id: conversation.id,
        title: 'Test Conversation',
        userId: testUser.id,
      });
    });

    it('returns 401 when unauthenticated', async () => {
      const response = await client.get('/api/conversations');
      
      expect(response.status).toBe(401);
      expect(response.data).toEqual({ error: 'Unauthorized' });
    });

    it('paginates results', async () => {
      // Arrange
      for (let i = 0; i < 15; i++) {
        await testDataFactory.createConversation({
          userId: testUser.id,
          title: `Conversation ${i}`,
        });
      }

      // Act - First page
      const page1 = await client.get('/api/conversations?limit=10&page=1', authToken);
      
      // Assert
      expect(page1.status).toBe(200);
      expect(page1.data).toHaveLength(10);
      expect(page1.headers['x-total-count']).toBe('15');
      expect(page1.headers['x-page']).toBe('1');
      expect(page1.headers['x-total-pages']).toBe('2');

      // Act - Second page
      const page2 = await client.get('/api/conversations?limit=10&page=2', authToken);
      
      // Assert
      expect(page2.status).toBe(200);
      expect(page2.data).toHaveLength(5);
      expect(page2.headers['x-page']).toBe('2');
    });
  });

  describe('POST /api/conversations', () => {
    it('creates new conversation', async () => {
      const conversationData = {
        title: 'New Conversation',
        agentId: 'test-agent-id',
      };

      const response = await client.post('/api/conversations', conversationData, authToken);

      expect(response.status).toBe(201);
      expect(response.data).toMatchObject({
        title: 'New Conversation',
        agentId: 'test-agent-id',
        userId: testUser.id,
      });
      expect(response.data).toHaveProperty('id');
      expect(response.data).toHaveProperty('createdAt');
    });

    it('validates required fields', async () => {
      const response = await client.post('/api/conversations', {}, authToken);

      expect(response.status).toBe(400);
      expect(response.data).toEqual({
        error: 'Validation failed',
        details: {
          title: 'Title is required',
          agentId: 'Agent ID is required',
        },
      });
    });

    it('returns 409 for duplicate conversation titles', async () => {
      const conversationData = {
        title: 'Duplicate',
        agentId: 'test-agent-id',
      };

      // First creation should succeed
      await client.post('/api/conversations', conversationData, authToken);

      // Second creation should fail
      const response = await client.post('/api/conversations', conversationData, authToken);

      expect(response.status).toBe(409);
      expect(response.data).toEqual({
        error: 'Conversation with this title already exists',
      });
    });
  });

  describe('WebSocket Integration', () => {
    it('handles real-time conversation updates', async () => {
      const conversation = await testDataFactory.createConversation({
        userId: testUser.id,
      });

      // Connect to WebSocket
      const ws = new WebSocket(`ws://localhost:3000/api/conversations/${conversation.id}/ws`);
      
      await new Promise((resolve) => {
        ws.onopen = resolve;
      });

      // Send message
      const message = { type: 'message', content: 'Hello World' };
      ws.send(JSON.stringify(message));

      // Receive echo
      const response = await new Promise((resolve) => {
        ws.onmessage = (event) => resolve(JSON.parse(event.data));
      });

      expect(response).toMatchObject({
        type: 'message',
        content: 'Hello World',
        userId: testUser.id,
      });

      ws.close();
    });
  });
});
```

### 3.2 Database Integration Testing
```typescript
// tests/integration/database/conversations-repository.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { ConversationRepository } from '@/lib/repositories/conversation-repository';
import { createTestDatabase, cleanupTestDatabase } from '../utils/test-database';
import { testDataFactory } from '../factories';

describe('ConversationRepository', () => {
  let repository: ConversationRepository;
  let testDb: any;

  beforeAll(async () => {
    testDb = await createTestDatabase();
    repository = new ConversationRepository(testDb);
  });

  afterAll(async () => {
    await cleanupTestDatabase(testDb);
  });

  beforeEach(async () => {
    await testDb.query('TRUNCATE TABLE conversations CASCADE');
  });

  describe('create', () => {
    it('creates a conversation', async () => {
      const conversationData = {
        userId: 'user-123',
        title: 'Test Conversation',
        agentId: 'agent-456',
      };

      const conversation = await repository.create(conversationData);

      expect(conversation).toMatchObject({
        id: expect.any(String),
        userId: 'user-123',
        title: 'Test Conversation',
        agentId: 'agent-456',
        createdAt: expect.any(Date),
        updatedAt: expect.any(Date),
      });
    });

    it('throws error for duplicate titles per user', async () => {
      const conversationData = {
        userId: 'user-123',
        title: 'Duplicate Title',
        agentId: 'agent-456',
      };

      await repository.create(conversationData);

      await expect(repository.create(conversationData)).rejects.toThrow(
        'Conversation with this title already exists'
      );
    });
  });

  describe('findByUser', () => {
    it('returns conversations for user', async () => {
      // Create test conversations
      await repository.create({ userId: 'user-1', title: 'Conversation 1', agentId: 'agent-1' });
      await repository.create({ userId: 'user-1', title: 'Conversation 2', agentId: 'agent-1' });
      await repository.create({ userId: 'user-2', title: 'Conversation 3', agentId: 'agent-1' });

      const conversations = await repository.findByUser('user-1');

      expect(conversations).toHaveLength(2);
      expect(conversations[0].userId).toBe('user-1');
      expect(conversations[1].userId).toBe('user-1');
    });

    it('paginates results', async () => {
      // Create 15 conversations
      for (let i = 0; i < 15; i++) {
        await repository.create({
          userId: 'user-1',
          title: `Conversation ${i}`,
          agentId: 'agent-1',
        });
      }

      const page1 = await repository.findByUser('user-1', { limit: 10, page: 1 });
      const page2 = await repository.findByUser('user-1', { limit: 10, page: 2 });

      expect(page1).toHaveLength(10);
      expect(page2).toHaveLength(5);
      expect(page1[0].title).toBe('Conversation 0');
      expect(page2[0].title).toBe('Conversation 10');
    });
  });

  describe('update', () => {
    it('updates conversation', async () => {
      const conversation = await repository.create({
        userId: 'user-123',
        title: 'Original Title',
        agentId: 'agent-456',
      });

      const updated = await repository.update(conversation.id, {
        title: 'Updated Title',
      });

      expect(updated.title).toBe('Updated Title');
      expect(updated.updatedAt.getTime()).toBeGreaterThan(conversation.updatedAt.getTime());
    });

    it('throws error for non-existent conversation', async () => {
      await expect(
        repository.update('non-existent-id', { title: 'New Title' })
      ).rejects.toThrow('Conversation not found');
    });
  });

  describe('delete', () => {
    it('deletes conversation', async () => {
      const conversation = await repository.create({
        userId: 'user-123',
        title: 'To Delete',
        agentId: 'agent-456',
      });

      const deleted = await repository.delete(conversation.id);
      expect(deleted).toBe(true);

      const found = await repository.findById(conversation.id);
      expect(found).toBeNull();
    });

    it('returns false for non-existent conversation', async () => {
      const deleted = await repository.delete('non-existent-id');
      expect(deleted).toBe(false);
    });
  });

  describe('transaction', () => {
    it('rolls back on error', async () => {
      try {
        await repository.transaction(async (tx) => {
          await tx.create({ userId: 'user-1', title: 'Conversation 1', agentId: 'agent-1' });
          await tx.create({ userId: 'user-1', title: 'Conversation 1', agentId: 'agent-1' }); // Duplicate - should fail
        });
      } catch (error) {
        // Expected to fail
      }

      // Check that no conversations were created (rollback)
      const conversations = await repository.findByUser('user-1');
      expect(conversations).toHaveLength(0);
    });
  });
});
```

## 4. END-TO-END TESTING STRATEGY

4.1 Playwright Configuration
typescript
// playwright.config.ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 4 : undefined,
  reporter: [
    ['html', { outputFolder: 'test-results/playwright-html' }],
    ['json', { outputFile: 'test-results/playwright-results.json' }],
    ['junit', { outputFile: 'test-results/playwright-results.xml' }],
    ['list'],
  ],
  
  use: {
    baseURL: process.env.PLAYWRIGHT_TEST_BASE_URL || 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 10000,
    navigationTimeout: 30000,
  },
  
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },
    {
      name: 'Mobile Chrome',
      use: { ...devices['Pixel 5'] },
    },
    {
      name: 'Mobile Safari',
      use: { ...devices['iPhone 12'] },
    },
  ],
  
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
});

4.2 E2E Test Structure
// tests/e2e/user-journeys/auth-flow.spec.ts
import { test, expect } from '@playwright/test';
import { testUserFactory } from '../factories/user-factory';

test.describe('Authentication Flow', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('user can sign up', async ({ page }) => {
    // Arrange
    const testUser = testUserFactory.create();
    
    // Act - Navigate to sign up
    await page.getByRole('button', { name: /sign up/i }).click();
    await expect(page).toHaveURL('/auth/signup');
    
    // Fill sign up form
    await page.getByLabel(/email/i).fill(testUser.email);
    await page.getByLabel(/password/i).fill(testUser.password);
    await page.getByLabel(/confirm password/i).fill(testUser.password);
    await page.getByRole('button', { name: /create account/i }).click();
    
    // Assert
    await expect(page).toHaveURL('/dashboard');
    await expect(page.getByText(/welcome, /i)).toBeVisible();
    
    // Verify user is created in database
    const user = await testUserFactory.findByEmail(testUser.email);
    expect(user).toBeDefined();
    expect(user?.email).toBe(testUser.email);
  });

  test('user can log in', async ({ page }) => {
    // Arrange
    const testUser = await testUserFactory.createInDatabase();
    
    // Act
    await page.getByRole('button', { name: /log in/i }).click();
    await expect(page).toHaveURL('/auth/login');
    
    await page.getByLabel(/email/i).fill(testUser.email);
    await page.getByLabel(/password/i).fill('password123');
    await page.getByRole('button', { name: /sign in/i }).click();
    
    // Assert
    await expect(page).toHaveURL('/dashboard');
    await expect(page.getByText(new RegExp(`welcome, ${testUser.name}`, 'i'))).toBeVisible();
  });

  test('user sees error for invalid credentials', async ({ page }) => {
    // Act
    await page.getByRole('button', { name: /log in/i }).click();
    await page.getByLabel(/email/i).fill('nonexistent@example.com');
    await page.getByLabel(/password/i).fill('wrongpassword');
    await page.getByRole('button', { name: /sign in/i }).click();
    
    // Assert
    await expect(page.getByText(/invalid email or password/i)).toBeVisible();
    await expect(page).toHaveURL('/auth/login');
  });

  test('user can reset password', async ({ page }) => {
    // Arrange
    const testUser = await testUserFactory.createInDatabase();
    
    // Act - Request password reset
    await page.getByRole('button', { name: /log in/i }).click();
    await page.getByRole('link', { name: /forgot password/i }).click();
    await expect(page).toHaveURL('/auth/reset-password');
    
    await page.getByLabel(/email/i).fill(testUser.email);
    await page.getByRole('button', { name: /send reset link/i }).click();
    
    // Assert - Success message
    await expect(page.getByText(/check your email for reset link/i)).toBeVisible();
    
    // TODO: Test email delivery and link click
    // This would require mocking the email service
  });

  test('user can log out', async ({ page }) => {
    // Arrange - Log in first
    const testUser = await testUserFactory.createInDatabase();
    await page.goto('/auth/login');
    await page.getByLabel(/email/i).fill(testUser.email);
    await page.getByLabel(/password/i).fill('password123');
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page).toHaveURL('/dashboard');
    
    // Act - Log out
    await page.getByRole('button', { name: /user menu/i }).click();
    await page.getByRole('menuitem', { name: /log out/i }).click();
    
    // Assert
    await expect(page).toHaveURL('/');
    await expect(page.getByRole('button', { name: /log in/i })).toBeVisible();
  });
});

// tests/e2e/user-journeys/conversation-flow.spec.ts
import { test, expect } from '@playwright/test';

test.describe('Conversation Flow', () => {
  test.beforeEach(async ({ page }) => {
    // Log in before each test
    await page.goto('/auth/login');
    await page.getByLabel(/email/i).fill('test@example.com');
    await page.getByLabel(/password/i).fill('password123');
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page).toHaveURL('/dashboard');
  });

  test('user can create a conversation', async ({ page }) => {
    // Act
    await page.getByRole('button', { name: /new conversation/i }).click();
    await page.getByLabel(/conversation title/i).fill('My First Conversation');
    await page.getByRole('button', { name: /create/i }).click();
    
    // Assert
    await expect(page).toHaveURL(/\/conversations\/[a-zA-Z0-9-]+/);
    await expect(page.getByText(/my first conversation/i)).toBeVisible();
    await expect(page.getByPlaceholder(/type your message/i)).toBeVisible();
  });

  test('user can send and receive messages', async ({ page }) => {
    // Arrange
    await page.getByRole('button', { name: /new conversation/i }).click();
    await page.getByLabel(/conversation title/i).fill('Test Chat');
    await page.getByRole('button', { name: /create/i }).click();
    
    // Act - Send message
    const message = 'Hello, how are you?';
    await page.getByPlaceholder(/type your message/i).fill(message);
    await page.getByRole('button', { name: /send/i }).click();
    
    // Assert - Message appears
    await expect(page.getByText(message)).toBeVisible();
    
    // Assert - AI response (mocked)
    await expect(page.getByText(/hello! i'm doing well, thank you/i)).toBeVisible({
      timeout: 30000,
    });
  });

  test('user can edit conversation title', async ({ page }) => {
    // Arrange
    await page.getByRole('button', { name: /new conversation/i }).click();
    await page.getByLabel(/conversation title/i).fill('Original Title');
    await page.getByRole('button', { name: /create/i }).click();
    
    // Act - Edit title
    await page.getByRole('button', { name: /edit title/i }).click();
    await page.getByLabel(/edit title/i).fill('Updated Title');
    await page.getByRole('button', { name: /save/i }).click();
    
    // Assert
    await expect(page.getByText(/updated title/i)).toBeVisible();
    await expect(page.getByText(/original title/i)).not.toBeVisible();
  });

  test('user can delete conversation', async ({ page }) => {
    // Arrange
    await page.getByRole('button', { name: /new conversation/i }).click();
    await page.getByLabel(/conversation title/i).fill('To Delete');
    await page.getByRole('button', { name: /create/i }).click();
    
    // Act - Delete
    await page.getByRole('button', { name: /delete conversation/i }).click();
    await page.getByRole('button', { name: /confirm delete/i }).click();
    
    // Assert
    await expect(page).toHaveURL('/dashboard');
    await expect(page.getByText(/to delete/i)).not.toBeVisible();
  });

  test('conversation history persists', async ({ page, context }) => {
    // Arrange - Create conversation
    await page.getByRole('button', { name: /new conversation/i }).click();
    await page.getByLabel(/conversation title/i).fill('Persistent Chat');
    await page.getByRole('button', { name: /create/i }).click();
    
    // Send a message
    await page.getByPlaceholder(/type your message/i).fill('Test persistence');
    await page.getByRole('button', { name: /send/i }).click();
    
    // Get conversation URL
    const conversationUrl = page.url();
    
    // Act - Close browser and reopen
    await context.clearCookies();
    await page.reload();
    
    // Log in again
    await page.getByLabel(/email/i).fill('test@example.com');
    await page.getByLabel(/password/i).fill('password123');
    await page.getByRole('button', { name: /sign in/i }).click();
    
    // Navigate back to conversation
    await page.goto(conversationUrl);
    
    // Assert
    await expect(page.getByText(/persistent chat/i)).toBeVisible();
    await expect(page.getByText(/test persistence/i)).toBeVisible();
  });
});

// tests/e2e/user-journeys/agent-management.spec.ts
import { test, expect } from '@playwright/test';

test.describe('Agent Management', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/auth/login');
    await page.getByLabel(/email/i).fill('test@example.com');
    await page.getByLabel(/password/i).fill('password123');
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page).toHaveURL('/dashboard');
  });

  test('user can create an agent', async ({ page }) => {
    // Act
    await page.getByRole('link', { name: /agents/i }).click();
    await page.getByRole('button', { name: /create agent/i }).click();
    
    await page.getByLabel(/agent name/i).fill('My Assistant');
    await page.getByLabel(/description/i).fill('A helpful AI assistant');
    await page.getByLabel(/model/i).selectOption('gpt-4');
    await page.getByLabel(/temperature/i).fill('0.7');
    await page.getByRole('button', { name: /create agent/i }).click();
    
    // Assert
    await expect(page.getByText(/agent created successfully/i)).toBeVisible();
    await expect(page.getByText(/my assistant/i)).toBeVisible();
    await expect(page.getByText(/a helpful ai assistant/i)).toBeVisible();
  });

  test('user can edit agent settings', async ({ page }) => {
    // Arrange - Create agent first
    await page.getByRole('link', { name: /agents/i }).click();
    await page.getByRole('button', { name: /create agent/i }).click();
    await page.getByLabel(/agent name/i).fill('Original Agent');
    await page.getByRole('button', { name: /create agent/i }).click();
    
    // Act - Edit agent
    await page.getByRole('button', { name: /edit agent/i }).first().click();
    await page.getByLabel(/agent name/i).fill('Updated Agent');
    await page.getByLabel(/description/i).fill('Updated description');
    await page.getByRole('button', { name: /save changes/i }).click();
    
    // Assert
    await expect(page.getByText(/agent updated successfully/i)).toBeVisible();
    await expect(page.getByText(/updated agent/i)).toBeVisible();
    await expect(page.getByText(/updated description/i)).toBeVisible();
  });

  test('user can delete agent', async ({ page }) => {
    // Arrange - Create agent
    await page.getByRole('link', { name: /agents/i }).click();
    await page.getByRole('button', { name: /create agent/i }).click();
    await page.getByLabel(/agent name/i).fill('Agent to Delete');
    await page.getByRole('button', { name: /create agent/i }).click();
    
    // Act - Delete agent
    await page.getByRole('button', { name: /delete agent/i }).first().click();
    await page.getByRole('button', { name: /confirm delete/i }).click();
    
    // Assert
    await expect(page.getByText(/agent deleted successfully/i)).toBeVisible();
    await expect(page.getByText(/agent to delete/i)).not.toBeVisible();
  });

  test('agent settings affect conversation behavior', async ({ page }) => {
    // Arrange - Create agent with specific settings
    await page.getByRole('link', { name: /agents/i }).click();
    await page.getByRole('button', { name: /create agent/i }).click();
    
    await page.getByLabel(/agent name/i).fill('Formal Assistant');
    await page.getByLabel(/description/i).fill('A formal and professional assistant');
    await page.getByLabel(/model/i).selectOption('gpt-4');
    await page.getByLabel(/temperature/i).fill('0.2'); // Low temperature for consistent responses
    await page.getByLabel(/system prompt/i).fill('You are a formal assistant. Always use proper grammar and formal language.');
    await page.getByRole('button', { name: /create agent/i }).click();
    
    // Create conversation with this agent
    await page.getByRole('button', { name: /new conversation/i }).click();
    await page.getByLabel(/conversation title/i).fill('Formal Chat');
    await page.getByLabel(/select agent/i).selectOption('Formal Assistant');
    await page.getByRole('button', { name: /create/i }).click();
    
    // Send message
    await page.getByPlaceholder(/type your message/i).fill('Hello');
    await page.getByRole('button', { name: /send/i }).click();
    
    // Assert - Response should be formal
    const response = page.getByTestId('ai-response');
    await expect(response).toBeVisible();
    await expect(response).toContainText(/greetings|hello|good (day|afternoon|evening)/i);
  });
});

5. PERFORMANCE TESTING
5.1 Load Testing with k6
javascript
// tests/performance/load-test.js
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

export const options = {
  stages: [
    { duration: '30s', target: 50 },  // Ramp up to 50 users
    { duration: '1m', target: 100 },  // Ramp up to 100 users
    { duration: '2m', target: 200 },   // Stay at 200 users
    { duration: '30s', target: 50 },   // Ramp down to 50 users
    { duration: '30s', target: 0 },     // Ramp down to 0 users
  ],
  thresholds: {
    http_req_duration: ['p(95)<500'],  // 95% of requests should be below 500ms
    http_req_failed: ['rate<0.01'],    // Less than 1% failures
  },
  ext: {
    loadimpact: {
      name: 'Agent Trinity Load Test',
    },
  },
};

const errorRate = new Rate('errors');
const responseTime = new Trend('response_time');

export function setup() {
  // Login and get token
  const loginRes = http.post('https://api.agent-trinity.com/auth/login', {
    email: 'loadtest@example.com',
    password: 'testpassword123',
  });
  
  const authToken = loginRes.json('token');
  
  // Create test data
  const conversationRes = http.post(
    'https://api.agent-trinity.com/api/conversations',
    {
      title: 'Load Test Conversation',
      agentId: 'test-agent-id',
    },
    { headers: { Authorization: `Bearer ${authToken}` } }
  );
  
  const conversationId = conversationRes.json('id');
  
  return { authToken, conversationId };
}

export default function (data) {
  const params = {
    headers: {
      'Authorization': `Bearer ${data.authToken}`,
      'Content-Type': 'application/json',
    },
  };
  
  // Test 1: Get conversations list
  const conversationsRes = http.get(
    'https://api.agent-trinity.com/api/conversations',
    params
  );
  
  check(conversationsRes, {
    'conversations list status is 200': (r) => r.status === 200,
    'conversations list has data': (r) => r.json().length >= 0,
  });
  
  errorRate.add(conversationsRes.status !== 200);
  responseTime.add(conversationsRes.timings.duration);
  
  // Test 2: Send message
  const messageRes = http.post(
    `https://api.agent-trinity.com/api/conversations/${data.conversationId}/messages`,
    {
      content: 'Load test message',
      role: 'user',
    },
    params
  );
  
  check(messageRes, {
    'message creation status is 201': (r) => r.status === 201,
    'message has id': (r) => r.json().id !== undefined,
  });
  
  errorRate.add(messageRes.status !== 201);
  responseTime.add(messageRes.timings.duration);
  
  // Test 3: Get conversation details
  const conversationRes = http.get(
    `https://api.agent-trinity.com/api/conversations/${data.conversationId}`,
    params
  );
  
  check(conversationRes, {
    'conversation details status is 200': (r) => r.status === 200,
    'conversation has messages': (r) => r.json().messages.length >= 0,
  });
  
  errorRate.add(conversationRes.status !== 200);
  responseTime.add(conversationRes.timings.duration);
  
  // Wait between iterations
  sleep(1);
}

export function teardown(data) {
  // Cleanup: Delete the conversation
  const deleteRes = http.del(
    `https://api.agent-trinity.com/api/conversations/${data.conversationId}`,
    {
      headers: {
        'Authorization': `Bearer ${data.authToken}`,
      },
    }
  );
  console.log(`Cleanup status: ${deleteRes.status}`);
}

5.2 Performance Test Scenarios
javascript
// tests/performance/api-load-test.js
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';

export const options = {
  scenarios: {
    smoke_test: {
      executor: 'ramping-vus',
      startVUs: 1,
      stages: [
        { duration: '30s', target: 10 },
        { duration: '1m', target: 10 },
        { duration: '30s', target: 0 },
      ],
      tags: { test_type: 'smoke' },
    },
    load_test: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '5m', target: 100 },
        { duration: '10m', target: 100 },
        { duration: '5m', target: 0 },
      ],
      tags: { test_type: 'load' },
    },
    stress_test: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '5m', target: 200 },
        { duration: '10m', target: 200 },
        { duration: '5m', target: 0 },
      ],
      tags: { test_type: 'stress' },
    },
    spike_test: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '2m', target: 1000 },
        { duration: '1m', target: 1000 },
        { duration: '2m', target: 0 },
      ],
      tags: { test_type: 'spike' },
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<500', 'p(99)<1000'],
    http_req_failed: ['rate<0.01'],
    'http_req_duration{test_type:smoke}': ['p(95)<300'],
    'http_req_duration{test_type:load}': ['p(95)<500'],
    'http_req_duration{test_type:stress}': ['p(95)<1000'],
    'http_req_duration{test_type:spike}': ['p(95)<2000'],
  },
};

const requestCounter = new Counter('total_requests');
const errorCounter = new Counter('total_errors');
const successRate = new Rate('successful_requests');
const responseTime = new Trend('response_time_ms');

const BASE_URL = __ENV.BASE_URL || 'https://api.agent-trinity.com';

export function setup() {
  return {
    authToken: __ENV.AUTH_TOKEN || 'test-token',
    testData: generateTestData(),
  };
}

function generateTestData() {
  return {
    conversations: Array.from({ length: 10 }, (_, i) => ({
      id: `conv-${i}`,
      title: `Test Conversation ${i}`,
    })),
    messages: Array.from({ length: 100 }, (_, i) => ({
      id: `msg-${i}`,
      content: `Test message ${i}`,
      role: i % 2 === 0 ? 'user' : 'assistant',
    })),
    agents: Array.from({ length: 5 }, (_, i) => ({
      id: `agent-${i}`,
      name: `Test Agent ${i}`,
      model: 'gpt-4',
    })),
  };
}

export default function (data) {
  const headers = {
    'Authorization': `Bearer ${data.authToken}`,
    'Content-Type': 'application/json',
  };

  // Test different endpoints with different weights
  const endpoints = [
    { weight: 3, fn: testGetConversations },
    { weight: 2, fn: testCreateMessage },
    { weight: 1, fn: testGetAgent },
    { weight: 1, fn: testUpdateConversation },
    { weight: 1, fn: testDeleteMessage },
  ];

  const endpoint = weightedRandom(endpoints);
  endpoint.fn(headers, data.testData);
}

function weightedRandom(endpoints) {
  const totalWeight = endpoints.reduce((sum, e) => sum + e.weight, 0);
  let random = Math.random() * totalWeight;
  
  for (const endpoint of endpoints) {
    random -= endpoint.weight;
    if (random <= 0) return endpoint;
  }
  
  return endpoints[0];
}

function testGetConversations(headers, testData) {
  const conversation = testData.conversations[
    Math.floor(Math.random() * testData.conversations.length)
  ];
  
  const startTime = Date.now();
  const res = http.get(`${BASE_URL}/api/conversations/${conversation.id}`, { headers });
  const duration = Date.now() - startTime;
  
  requestCounter.add(1);
  responseTime.add(duration);
  
  const success = check(res, {
    'status is 200': (r) => r.status === 200,
    'response time < 500ms': (r) => r.timings.duration < 500,
  });
  
  if (!success) errorCounter.add(1);
  successRate.add(success);
  
  sleep(Math.random() * 2);
}

function testCreateMessage(headers, testData) {
  const conversation = testData.conversations[
    Math.floor(Math.random() * testData.conversations.length)
  ];
  const message = testData.messages[
    Math.floor(Math.random() * testData.messages.length)
  ];
  
  const payload = JSON.stringify({
    conversationId: conversation.id,
    content: message.content,
    role: 'user',
  });
  
  const startTime = Date.now();
  const res = http.post(`${BASE_URL}/api/messages`, payload, { headers });
  const duration = Date.now() - startTime;
  
  requestCounter.add(1);
  responseTime.add(duration);
  
  const success = check(res, {
    'status is 201': (r) => r.status === 201,
    'response time < 1000ms': (r) => r.timings.duration < 1000,
    'has message id': (r) => r.json('id') !== undefined,
  });
  
  if (!success) errorCounter.add(1);
  successRate.add(success);
  
  sleep(Math.random() * 3);
}

function testGetAgent(headers, testData) {
  const agent = testData.agents[
    Math.floor(Math.random() * testData.agents.length)
  ];
  
  const startTime = Date.now();
  const res = http.get(`${BASE_URL}/api/agents/${agent.id}`, { headers });
  const duration = Date.now() - startTime;
  
  requestCounter.add(1);
  responseTime.add(duration);
  
  const success = check(res, {
    'status is 200': (r) => r.status === 200,
    'response time < 300ms': (r) => r.timings.duration < 300,
    'has agent name': (r) => r.json('name') !== undefined,
  });
  
  if (!success) errorCounter.add(1);
  successRate.add(success);
  
  sleep(Math.random() * 1);
}

function testUpdateConversation(headers, testData) {
  const conversation = testData.conversations[
    Math.floor(Math.random() * testData.conversations.length)
  ];
  
  const payload = JSON.stringify({
    title: `Updated ${conversation.title} ${Date.now()}`,
  });
  
  const startTime = Date.now();
  const res = http.patch(
    `${BASE_URL}/api/conversations/${conversation.id}`,
    payload,
    { headers }
  );
  const duration = Date.now() - startTime;
  
  requestCounter.add(1);
  responseTime.add(duration);
  
  const success = check(res, {
    'status is 200': (r) => r.status === 200,
    'response time < 400ms': (r) => r.timings.duration < 400,
    'title is updated': (r) => r.json('title').includes('Updated'),
  });
  
  if (!success) errorCounter.add(1);
  successRate.add(success);
  
  sleep(Math.random() * 2);
}

function testDeleteMessage(headers, testData) {
  const message = testData.messages[
    Math.floor(Math.random() * testData.messages.length)
  ];
  
  const startTime = Date.now();
  const res = http.del(`${BASE_URL}/api/messages/${message.id}`, null, { headers });
  const duration = Date.now() - startTime;
  
  requestCounter.add(1);
  responseTime.add(duration);
  
  const success = check(res, {
    'status is 204': (r) => r.status === 204,
    'response time < 300ms': (r) => r.timings.duration < 300,
  });
  
  if (!success) errorCounter.add(1);
  successRate.add(success);
  
  sleep(Math.random() * 1);
}

5.3 Performance Monitoring Dashboard
typescript
// components/dashboard/performance-dashboard.tsx
import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

interface PerformanceMetric {
  timestamp: string;
  responseTime: number;
  errorRate: number;
  throughput: number;
  cpuUsage: number;
  memoryUsage: number;
}

interface PerformanceDashboardProps {
  metrics: PerformanceMetric[];
  timeframe: '1h' | '24h' | '7d' | '30d';
}

export function PerformanceDashboard({ metrics, timeframe }: PerformanceDashboardProps) {
  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          title="Response Time (P95)"
          value={`${calculateP95(metrics.map(m => m.responseTime))}ms`}
          trend="down"
          trendValue={-12}
          description="95th percentile response time"
        />
        <MetricCard
          title="Error Rate"
          value={`${calculateAverage(metrics.map(m => m.errorRate)).toFixed(2)}%`}
          trend="down"
          trendValue={-5}
          description="Percentage of failed requests"
        />
        <MetricCard
          title="Throughput"
          value={`${formatNumber(calculateAverage(metrics.map(m => m.throughput)))} RPM`}
          trend="up"
          trendValue={8}
          description="Requests per minute"
        />
        <MetricCard
          title="Uptime"
          value="99.95%"
          trend="stable"
          trendValue={0}
          description="Service availability"
        />
      </div>

      {/* Charts */}
      <Tabs defaultValue="response-time" className="space-y-4">
        <TabsList>
          <TabsTrigger value="response-time">Response Time</TabsTrigger>
          <TabsTrigger value="throughput">Throughput</TabsTrigger>
          <TabsTrigger value="errors">Errors</TabsTrigger>
          <TabsTrigger value="resources">Resources</TabsTrigger>
        </TabsList>
        
        <TabsContent value="response-time" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Response Time Trends</CardTitle>
              <CardDescription>
                Average and P95 response times over time
              </CardDescription>
            </CardHeader>
            <CardContent className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={metrics}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="timestamp" />
                  <YAxis label={{ value: 'ms', angle: -90, position: 'insideLeft' }} />
                  <Tooltip />
                  <Legend />
                  <Line type="monotone" dataKey="responseTime" stroke="#8884d8" name="Avg Response Time" />
                  <Line type="monotone" dataKey="p95" stroke="#82ca9d" name="P95 Response Time" />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </TabsContent>
        
        <TabsContent value="throughput" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Throughput Trends</CardTitle>
              <CardDescription>
                Requests per minute over time
              </CardDescription>
            </CardHeader>
            <CardContent className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={metrics}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="timestamp" />
                  <YAxis label={{ value: 'RPM', angle: -90, position: 'insideLeft' }} />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="throughput" fill="#8884d8" name="Throughput" />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </TabsContent>
        
        <TabsContent value="errors" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Error Rate Trends</CardTitle>
              <CardDescription>
                Error percentage and count over time
              </CardDescription>
            </CardHeader>
            <CardContent className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={metrics}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="timestamp" />
                  <YAxis label={{ value: '%', angle: -90, position: 'insideLeft' }} />
                  <Tooltip />
                  <Legend />
                  <Line type="monotone" dataKey="errorRate" stroke="#ff7300" name="Error Rate" />
                  <Line type="monotone" dataKey="errorCount" stroke="#ff0000" name="Error Count" />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </TabsContent>
        
        <TabsContent value="resources" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Resource Utilization</CardTitle>
              <CardDescription>
                CPU and memory usage over time
              </CardDescription>
            </CardHeader>
            <CardContent className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={metrics}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="timestamp" />
                  <YAxis label={{ value: '%', angle: -90, position: 'insideLeft' }} />
                  <Tooltip />
                  <Legend />
                  <Line type="monotone" dataKey="cpuUsage" stroke="#0088fe" name="CPU Usage" />
                  <Line type="monotone" dataKey="memoryUsage" stroke="#00c49f" name="Memory Usage" />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Performance Recommendations */}
      <Card>
        <CardHeader>
          <CardTitle>Performance Recommendations</CardTitle>
          <CardDescription>
            Based on current metrics and trends
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2">
            {generateRecommendations(metrics).map((rec, index) => (
              <li key={index} className="flex items-start space-x-2">
                <div className={`h-2 w-2 mt-2 rounded-full ${rec.severity === 'high' ? 'bg-red-500' : rec.severity === 'medium' ? 'bg-yellow-500' : 'bg-blue-500'}`} />
                <div>
                  <p className="font-medium">{rec.title}</p>
                  <p className="text-sm text-muted-foreground">{rec.description}</p>
                </div>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}

function MetricCard({ title, value, trend, trendValue, description }: {
  title: string;
  value: string;
  trend: 'up' | 'down' | 'stable';
  trendValue: number;
  description: string;
}) {
  const trendColor = trend === 'up' ? 'text-green-600' : trend === 'down' ? 'text-red-600' : 'text-gray-600';
  const trendIcon = trend === 'up' ? '↗' : trend === 'down' ? '↘' : '→';
  
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <div className={`text-xs font-bold ${trendColor}`}>
          {trendIcon} {Math.abs(trendValue)}%
        </div>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
        <p className="text-xs text-muted-foreground">{description}</p>
      </CardContent>
    </Card>
  );
}

function calculateP95(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.ceil(sorted.length * 0.95) - 1;
  return Math.round(sorted[index]);
}

function calculateAverage(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, val) => sum + val, 0) / values.length;
}

function formatNumber(num: number): string {
  if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
  if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
  return num.toFixed(0);
}

function generateRecommendations(metrics: PerformanceMetric[]): Array<{
  title: string;
  description: string;
  severity: 'low' | 'medium' | 'high';
}> {
  const recommendations = [];
  const avgResponseTime = calculateAverage(metrics.map(m => m.responseTime));
  const avgErrorRate = calculateAverage(metrics.map(m => m.errorRate));
  const avgCpuUsage = calculateAverage(metrics.map(m => m.cpuUsage));
  
  if (avgResponseTime > 1000) {
    recommendations.push({
      title: 'High Response Time',
      description: 'Average response time exceeds 1s. Consider optimizing database queries or adding caching.',
      severity: 'high',
    });
  } else if (avgResponseTime > 500) {
    recommendations.push({
      title: 'Moderate Response Time',
      description: 'Response time between 500ms-1s. Monitor and consider optimizations.',
      severity: 'medium',
    });
  }
  
  if (avgErrorRate > 5) {
    recommendations.push({
      title: 'High Error Rate',
      description: 'Error rate exceeds 5%. Investigate API failures and external dependencies.',
      severity: 'high',
    });
  } else if (avgErrorRate > 1) {
    recommendations.push({
      title: 'Elevated Error Rate',
      description: 'Error rate between 1-5%. Review error logs and retry logic.',
      severity: 'medium',
    });
  }
  
  if (avgCpuUsage > 80) {
    recommendations.push({
      title: 'High CPU Usage',
      description: 'CPU usage exceeds 80%. Consider scaling horizontally or optimizing code.',
      severity: 'high',
    });
  } else if (avgCpuUsage > 60) {
    recommendations.push({
      title: 'Moderate CPU Usage',
      description: 'CPU usage between 60-80%. Monitor and consider optimizations.',
      severity: 'medium',
    });
  }
  
  if (recommendations.length === 0) {
    recommendations.push({
      title: 'Performance Optimal',
      description: 'All metrics are within acceptable ranges.',
      severity: 'low',
    });
  }
  
  return recommendations;
}

6. SECURITY TESTING
6.1 Security Test Suite
typescript
// tests/security/security.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SecurityAuditor } from '@/lib/security/auditor';
import { createMockSupabaseClient } from '../mocks/supabase';

describe('Security Auditor', () => {
  let auditor: SecurityAuditor;
  let mockSupabase: any;

  beforeEach(() => {
    mockSupabase = createMockSupabaseClient();
    auditor = new SecurityAuditor(mockSupabase);
  });

  describe('SQL Injection Tests', () => {
    it('prevents SQL injection in user input', async () => {
      const maliciousInput = "'; DROP TABLE users; --";
      
      const result = await auditor.testSqlInjection(maliciousInput);
      
      expect(result.vulnerable).toBe(false);
      expect(result.detected).toBe(true);
      expect(result.recommendation).toContain('Use parameterized queries');
    });

    it('validates parameterized queries work correctly', async () => {
      const safeInput = 'test@example.com';
      
      const result = await auditor.testSqlInjection(safeInput);
      
      expect(result.vulnerable).toBe(false);
      expect(result.detected).toBe(false);
    });
  });

  describe('XSS Tests', () => {
    it('detects reflected XSS vulnerabilities', async () => {
      const xssPayload = '<script>alert("XSS")</script>';
      
      const result = await auditor.testXss(xssPayload);
      
      expect(result.vulnerable).toBe(false);
      expect(result.detected).toBe(true);
      expect(result.recommendation).toContain('Implement output encoding');
    });

    it('validates HTML encoding', async () => {
      const safeInput = 'Hello World';
      
      const result = await auditor.testXss(safeInput);
      
      expect(result.vulnerable).toBe(false);
      expect(result.detected).toBe(false);
    });
  });

  describe('Authentication Tests', () => {
    it('detects weak passwords', async () => {
      const weakPasswords = ['password', '123456', 'qwerty', 'admin'];
      
      for (const password of weakPasswords) {
        const result = await auditor.testPasswordStrength(password);
        expect(result.strong).toBe(false);
        expect(result.recommendations).toContain('Use stronger password');
      }
    });

    it('validates strong passwords', async () => {
      const strongPassword = 'CorrectHorseBatteryStaple!123';
      
      const result = await auditor.testPasswordStrength(strongPassword);
      
      expect(result.strong).toBe(true);
      expect(result.score).toBeGreaterThanOrEqual(80);
    });

    it('tests rate limiting', async () => {
      const ip = '192.168.1.1';
      const requests = Array.from({ length: 101 }, (_, i) => i);
      
      let blocked = false;
      for (const _ of requests) {
        const result = await auditor.testRateLimit(ip);
        if (result.blocked) {
          blocked = true;
          break;
        }
      }
      
      expect(blocked).toBe(true);
    });
  });

  describe('Authorization Tests', () => {
    it('prevents unauthorized access', async () => {
      const user1Token = 'token-user-1';
      const user2Token = 'token-user-2';
      const resourceId = 'resource-123';
      
      // User 1 creates resource
      await auditor.createResource(user1Token, resourceId);
      
      // User 2 tries to access user 1's resource
      const result = await auditor.accessResource(user2Token, resourceId);
      
      expect(result.allowed).toBe(false);
      expect(result.error).toBe('Unauthorized');
    });

    it('allows authorized access', async () => {
      const userToken = 'token-user-1';
      const resourceId = 'resource-123';
      
      // User creates resource
      await auditor.createResource(userToken, resourceId);
      
      // Same user accesses resource
      const result = await auditor.accessResource(userToken, resourceId);
      
      expect(result.allowed).toBe(true);
    });
  });

  describe('Data Validation Tests', () => {
    it('validates input types', async () => {
      const invalidInputs = [
        { email: 'not-an-email', expected: false },
        { email: 'test@example.com', expected: true },
        { age: -5, expected: false },
        { age: 25, expected: true },
        { price: 'not-a-number', expected: false },
        { price: 19.99, expected: true },
      ];
      
      for (const { email, age, price, expected } of invalidInputs) {
        const result = await auditor.validateInput({ email, age, price });
        expect(result.valid).toBe(expected);
      }
    });

    it('sanitizes HTML input', async () => {
      const htmlInput = '<script>alert("xss")</script><p>Hello</p>';
      
      const result = await auditor.sanitizeHtml(htmlInput);
      
      expect(result).not.toContain('<script>');
      expect(result).toContain('<p>Hello</p>');
    });
  });

  describe('Session Security Tests', () => {
    it('detects session fixation', async () => {
      const sessionId = 'fixed-session-id';
      
      const result = await auditor.testSessionFixation(sessionId);
      
      expect(result.vulnerable).toBe(false);
      expect(result.recommendation).toContain('Regenerate session ID on login');
    });

    it('validates session expiration', async () => {
      const oldSessionId = 'old-session-id';
      
      const result = await auditor.testSessionExpiration(oldSessionId);
      
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('Session expired');
    });
  });

  describe('API Security Tests', () => {
    it('tests for CSRF vulnerabilities', async () => {
      const result = await auditor.testCsrf();
      
      expect(result.vulnerable).toBe(false);
      expect(result.protection).toBe('CSRF tokens implemented');
    });

    it('tests for CORS misconfiguration', async () => {
      const maliciousOrigin = 'https://evil.com';
      
      const result = await auditor.testCors(maliciousOrigin);
      
      expect(result.allowed).toBe(false);
      expect(result.recommendation).toContain('Restrict allowed origins');
    });

    it('tests for HTTP security headers', async () => {
      const result = await auditor.testSecurityHeaders();
      
      expect(result.missingHeaders).toHaveLength(0);
      expect(result.recommendations).toEqual([]);
    });
  });
});

6.2 OWASP ZAP Integration
yaml
# zaproxy/scan-config.yml
scanner:
  activeScan: true
  passiveScan: true
  maxRuleDurationInMins: 10
  maxScanDurationInMins: 60

context:
  name: "Agent Trinity"
  includePaths:
    - "https://agent-trinity.com/api/*"
    - "https://agent-trinity.com/auth/*"
  excludePaths:
    - "https://agent-trinity.com/static/*"
    - "https://agent-trinity.com/_next/*"

authentication:
  method: "formBased"
  loginUrl: "https://agent-trinity.com/auth/login"
  loginRequestData: "email=test@example.com&password=password123"
  loggedInIndicator: "Welcome"
  loggedOutIndicator: "Sign in"

spider:
  maxDepth: 5
  maxChildren: 100
  acceptCookies: true
  processForms: true

activeScan:
  policy: "Default Policy"
  strength: "MEDIUM"
  threshold: "MEDIUM"

rules:
  enabled:
    - "10000"  # Buffer Overflow
    - "10001"  # Format String Error
    - "10002"  # Integer Overflow Error
    - "10003"  # Code Injection
    - "10010"  # Cross Site Scripting (Reflected)
    - "10011"  # Cross Site Scripting (Persistent)
    - "10012"  # Cross Site Scripting (DOM Based)
    - "10015"  # Cross Site Scripting (Persistent) - Prime
    - "10016"  # Cross Site Scripting (Reflected) - Prime
    - "10017"  # Cross Site Scripting (DOM Based) - Prime
    - "10021"  # HTTP Parameter Pollution
    - "10023"  # Source Code Disclosure
    - "10024"  # Directory Browsing
    - "10026"  # Remote Code Execution
    - "10027"  # CRLF Injection
    - "10028"  # Command Injection
    - "10029"  # Server Side Include
    - "10030"  # OS Command Injection
    - "10031"  # SQL Injection
    - "10032"  # LDAP Injection
    - "10033"  # XPATH Injection
    - "10034"  # XML Injection
    - "10035"  # SSI Injection
    - "10036"  # XPath Injection
    - "10037"  # XQuery Injection
    - "10038"  # XSLT Injection
    - "10039"  # XLink Injection
    - "10040"  # HTTP Response Splitting
    - "10041"  # HTTP Request Smuggling
    - "10042"  # HTTP Response Smuggling
    - "10045"  # Session Fixation
    - "10046"  # Session ID in URL Rewrite
    - "10047"  # Cross Site Request Forgery
    - "10048"  # Cross Site Tracing
    - "10049"  # Cross Site Flashing
    - "10050"  # Insecure HTTP Methods
    - "10051"  # HTTP Strict Transport Security
    - "10052"  # Clickjacking
    - "10053"  # Insecure Direct Object References
    - "10054"  # Missing Function Level Access Control
    - "10055"  # Security Misconfiguration
    - "10056"  # Sensitive Data Exposure
    - "10057"  # Missing Security Headers
    - "10058"  # Vulnerable JS Library
    - "10059"  # Weak Authentication
    - "10060"  # Weak Session Management
    - "10061"  # Insufficient Logging & Monitoring
    - "10062"  # Business Logic Errors
    - "10063"  # Insecure Deserialization
    - "10064"  # XXE Injection
    - "10065"  # SSRF
    - "10066"  # XXE Injection (Prime)
    - "10067"  # SSRF (Prime)
    - "10068"  # GraphQL Injection
    - "10069"  # JWT Vulnerabilities
    - "10070"  # WebSocket Security
    - "10071"  # Web Cache Poisoning
    - "10072"  # HTTP/2 Vulnerabilities
    - "10073"  # HTTP/3 Vulnerabilities
    - "10074"  # Prototype Pollution
    - "10075"  # DOM Clobbering

report:
  format: "html"
  theme: "dark"
  sections:
    - "alertcount"
    - "instancecount"
    - "alertdetails"
    - "passingrules"
    - "statistics"
  includePassiveAlerts: true
  includeActiveAlerts: true
  includeSummary: true
  includeDescription: true
  includeSolution: true
  includeReference: true
  includeCWE: true
  includeWASC: true

#### 6.3 Penetration Testing Implementation
```typescript
// Example penetration testing setup
export const pentestConfig = {
  scope: {
    apiEndpoints: ['/api/**', '/webhooks/**', '/auth/**'],
    excludedPaths: ['/api/health', '/api/metrics'],
  },
  tools: {
    staticAnalysis: ['OWASP ZAP', 'Burp Suite Enterprise'],
    dynamicAnalysis: ['Arachni Scanner', 'Nuclei'],
  },
  frequency: 'quarterly',
  reporting: {
    format: 'OWASP ASVS',
    severityThreshold: 'medium',
    autoRemediation: {
      enabled: true,
      workflow: 'github-issues',
    },
  },
}
```

#### 6.4 Vulnerability Scanning Pipeline
```yaml
# .github/workflows/vulnerability-scanning.yml
name: Security Scanning
on:
  schedule:
    - cron: '0 0 * * 0'  # Weekly
  pull_request:
    branches: [main]

jobs:
  scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Snyk Code Scan
        uses: snyk/actions/node@master
        with:
          args: code test --severity-threshold=high
        
      - name: Dependency Audit
        run: npm audit --audit-level=moderate
        
      - name: Container Scan
        uses: aquasecurity/trivy-action@master
        with:
          image-ref: 'ghcr.io/${{ github.repository }}:latest'
          format: 'sarif'
          
      - name: Upload Security Reports
        uses: actions/upload-artifact@v4
        with:
          name: security-reports
          path: |
            snyk-report.sarif
            trivy-results.sarif
```

#### 6.5 Security Headers Testing
```typescript
// tests/security/headers.test.ts
import { NextRequest } from 'next/server'
import { expect } from '@playwright/test'

describe('Security Headers', () => {
  const requiredHeaders = {
    'Content-Security-Policy': expect.stringContaining("default-src 'self'"),
    'X-Frame-Options': 'DENY',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': expect.stringContaining('camera=()'),
    'Strict-Transport-Security': expect.stringContaining('max-age=31536000'),
  }

  test.each(['/', '/api/health', '/auth/login'])(
    '%s should have security headers',
    async (path) => {
      const response = await fetch(`http://localhost:3000${path}`)
      for (const [header, expected] of Object.entries(requiredHeaders)) {
        const value = response.headers.get(header)
        if (typeof expected === 'string') {
          expect(value).toBe(expected)
        } else {
          expect(value).toMatch(expected)
        }
      }
    }
  )
})
```

#### 6.6 Input Validation Testing
```typescript
// tests/security/input-validation.test.ts
describe('Input Validation', () => {
  const maliciousPayloads = [
    { sql: "' OR '1'='1" },
    { xss: '<script>alert(1)</script>' },
    { pathTraversal: '../../../etc/passwd' },
    { commandInjection: '; ls -la' },
    { xxe: '<?xml version="1.0"?><!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>' },
  ]

  test.each(['/api/user', '/api/upload', '/api/search'])(
    '%s should reject malicious input',
    async (endpoint) => {
      for (const payload of maliciousPayloads) {
        const response = await fetch(`http://localhost:3000${endpoint}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        expect(response.status).toBe(400)
      }
    }
  )
})
```

### 7. Accessibility Testing

#### 7.1 WCAG Compliance Testing
```typescript
// tests/accessibility/wcag.test.ts
import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

test.describe('Accessibility', () => {
  const pages = ['/', '/dashboard', '/settings', '/auth/login']
  
  pages.forEach((path) => {
    test(`${path} should be accessible`, async ({ page }) => {
      await page.goto(`http://localhost:3000${path}`)
      await page.waitForLoadState('networkidle')
      
      const accessibilityScanResults = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
        .disableRules(['color-contrast']) // Handled by visual regression
        .analyze()
        
      expect(accessibilityScanResults.violations).toEqual([])
    })
  })
})
```

#### 7.2 Keyboard Navigation Testing
```typescript
// tests/accessibility/keyboard.test.ts
test('Keyboard navigation flow', async ({ page }) => {
  await page.goto('/')
  
  // Tab navigation
  await page.keyboard.press('Tab')
  await expect(page.locator(':focus')).toHaveAttribute('tabindex', '0')
  
  // Skip link functionality
  await page.keyboard.press('Tab')
  await page.keyboard.press('Enter')
  await expect(page.locator('#main-content')).toBeFocused()
  
  // Modal trapping
  await page.click('[aria-label="Open modal"]')
  await page.keyboard.press('Tab')
  await expect(page.locator('.modal-close-btn')).toBeFocused()
})
```

### 8. CI/CD Integration

#### 8.1 GitHub Actions Test Workflow
```yaml
# .github/workflows/test-suite.yml
name: Test Suite
on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:15
        env:
          POSTGRES_PASSWORD: postgres
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
        ports:
          - 5432:5432
    
    steps:
      - uses: actions/checkout@v4
      
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
          
      - name: Install dependencies
        run: npm ci
        
      - name: Run unit tests
        run: npm test -- --coverage
        env:
          DATABASE_URL: postgresql://postgres:postgres@localhost:5432/test_db
          
      - name: Run integration tests
        run: npm run test:integration
        
      - name: Run E2E tests
        uses: microsoft/playwright-github-action@v1
        
      - name: Run performance tests
        run: npm run test:performance
        
      - name: Upload coverage
        uses: codecov/codecov-action@v4
```

#### 8.2 Quality Gates
```yaml
# .github/workflows/quality-gates.yml
name: Quality Gates
on:
  pull_request:
    branches: [main]

jobs:
  quality:
    runs-on: ubuntu-latest
    steps:
      - name: SonarCloud Scan
        uses: SonarSource/sonarcloud-github-action@master
        env:
          SONAR_TOKEN: ${{ secrets.SONAR_TOKEN }}
          
      - name: Code Coverage Check
        run: |
          coverage=$(npm test -- --coverage --coverageReporters=text-summary | grep -E "Lines.*%" | cut -d'|' -f3 | tr -d ' %')
          if (( $(echo "$coverage < 80" | bc -l) )); then
            echo "Coverage below 80%: $coverage%"
            exit 1
          fi
          
      - name: Performance Budget Check
        run: |
          lighthouse-ci --config-path=lighthouserc.json
```

### 9. Test Data Management

#### 9.1 Factory Pattern Implementation
```typescript
// tests/factories/user.factory.ts
export class UserFactory {
  static create(overrides: Partial<User> = {}): User {
    return {
      id: crypto.randomUUID(),
      email: `test-${Date.now()}@example.com`,
      name: 'Test User',
      role: 'user',
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    }
  }
  
  static createAdmin(): User {
    return this.create({ role: 'admin' })
  }
  
  static createWithSubscription(): User {
    return this.create({
      subscription: {
        plan: 'pro',
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    })
  }
}
```

#### 9.2 Test Database Management
```typescript
// tests/setup/database.ts
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

export class TestDatabase {
  static async setup(): Promise<void> {
    await prisma.$connect()
    await prisma.$executeRaw`CREATE DATABASE IF NOT EXISTS test_db`
  }
  
  static async cleanup(): Promise<void> {
    // Truncate all tables
    const tables = await prisma.$queryRaw<
      { tablename: string }[]
    >`SELECT tablename FROM pg_tables WHERE schemaname = 'public'`
    
    for (const { tablename } of tables) {
      await prisma.$executeRawUnsafe(
        `TRUNCATE TABLE "${tablename}" CASCADE`
      )
    }
    
    await prisma.$disconnect()
  }
  
  static async seed(): Promise<void> {
    await prisma.user.createMany({
      data: [
        UserFactory.create(),
        UserFactory.createAdmin(),
        UserFactory.createWithSubscription(),
      ],
    })
  }
}
```

### 10. Reporting and Metrics

#### 10.1 Test Dashboard Integration
```typescript
// pages/api/test-metrics.ts
export default async function handler(req: NextRequest) {
  const metrics = {
    timestamp: new Date().toISOString(),
    unit: {
      total: 1250,
      passed: 1220,
      failed: 30,
      coverage: 92,
    },
    integration: {
      total: 450,
      passed: 445,
      failed: 5,
      avgResponseTime: 245,
    },
    e2e: {
      total: 120,
      passed: 118,
      failed: 2,
      flaky: 1,
    },
    performance: {
      p95: 1200,
      p99: 1800,
      failures: 0,
    },
    security: {
      vulnerabilities: {
        critical: 0,
        high: 2,
        medium: 5,
      },
      lastScan: new Date().toISOString(),
    },
  }
  
  return NextResponse.json(metrics)
}
```

#### 10.2 Alerting Configuration
```typescript
// utils/test-alerts.ts
export class TestAlertManager {
  static async checkThresholds(metrics: TestMetrics): Promise<void> {
    const thresholds = {
      unitCoverage: 80,
      integrationPassRate: 95,
      e2ePassRate: 90,
      p95ResponseTime: 2000,
      securityCritical: 0,
    }
    
    const alerts: string[] = []
    
    if (metrics.unit.coverage < thresholds.unitCoverage) {
      alerts.push(`Unit test coverage dropped to ${metrics.unit.coverage}%`)
    }
    
    if (metrics.e2e.passed / metrics.e2e.total * 100 < thresholds.e2ePassRate) {
      alerts.push(`E2E pass rate dropped to ${((metrics.e2e.passed / metrics.e2e.total) * 100).toFixed(1)}%`)
    }
    
    if (metrics.security.vulnerabilities.critical > thresholds.securityCritical) {
      alerts.push(`Critical vulnerabilities detected: ${metrics.security.vulnerabilities.critical}`)
    }
    
    if (alerts.length > 0) {
      await this.sendAlerts(alerts)
    }
  }
  
  static async sendAlerts(alerts: string[]): Promise<void> {
    // Send to Slack, Email, PagerDuty, etc.
    await fetch(process.env.ALERT_WEBHOOK_URL!, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        alerts,
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV,
      }),
    })
  }
}
```

—

