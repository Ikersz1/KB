import { Source, KBQuestion, Chunk } from '../types';

// Mock sources with demo content
export const mockSources: Source[] = [
  {
    id: 'src-1',
    type: 'pdf',
    name: 'Product Documentation.pdf',
    size: 2456789,
    status: 'completed',
    createdAt: '2025-01-01T10:00:00Z',
    chunks: [
      {
        id: 'chunk-1-1',
        sourceId: 'src-1',
        content: 'Our product offers advanced analytics capabilities with real-time data processing. The dashboard provides comprehensive insights into user behavior, conversion rates, and performance metrics.',
        index: 0,
        metadata: { page: 1, section: 'Introduction' }
      },
      {
        id: 'chunk-1-2',
        sourceId: 'src-1',
        content: 'Installation requires Node.js version 16 or higher. Run npm install followed by npm start to launch the development server. The application will be available at localhost:3000.',
        index: 1,
        metadata: { page: 2, section: 'Installation' }
      },
      {
        id: 'chunk-1-3',
        sourceId: 'src-1',
        content: 'API endpoints are secured with OAuth 2.0 authentication. Each request must include a valid bearer token in the Authorization header. Rate limiting is set to 1000 requests per hour.',
        index: 2,
        metadata: { page: 3, section: 'API Authentication' }
      }
    ]
  },
  {
    id: 'src-2',
    type: 'url',
    name: 'Company FAQ',
    url: 'https://example.com/faq',
    status: 'completed',
    createdAt: '2025-01-01T10:05:00Z',
    chunks: [
      {
        id: 'chunk-2-1',
        sourceId: 'src-2',
        content: 'Q: How do I reset my password? A: Click on the "Forgot Password" link on the login page and follow the instructions sent to your registered email address.',
        index: 0,
        metadata: { section: 'Account Management' }
      },
      {
        id: 'chunk-2-2',
        sourceId: 'src-2',
        content: 'Q: What payment methods do you accept? A: We accept all major credit cards, PayPal, and bank transfers. Enterprise customers can also use purchase orders.',
        index: 1,
        metadata: { section: 'Billing' }
      }
    ]
  }
];

// Mock generated questions
export const mockQuestions: KBQuestion[] = [
  {
    id: 'q-1',
    type: 'open',
    difficulty: 'easy',
    text: 'What analytics capabilities does the product offer?',
    expectedAnswer: 'Advanced analytics with real-time data processing, dashboard with user behavior insights, conversion rates, and performance metrics',
    references: [
      {
        sourceId: 'src-1',
        chunkIds: ['chunk-1-1']
      }
    ],
    tags: ['analytics', 'features']
  },
  {
    id: 'q-2',
    type: 'mcq',
    difficulty: 'medium',
    text: 'What is the minimum Node.js version required for installation?',
    options: ['Node.js 14', 'Node.js 16', 'Node.js 18', 'Node.js 20'],
    correctOptionIndex: 1,
    expectedAnswer: 'Node.js version 16 or higher',
    references: [
      {
        sourceId: 'src-1',
        chunkIds: ['chunk-1-2']
      }
    ],
    tags: ['installation', 'requirements']
  },
  {
    id: 'q-3',
    type: 'boolean',
    difficulty: 'easy',
    text: 'The API uses OAuth 2.0 for authentication.',
    expectedAnswer: 'True - API endpoints are secured with OAuth 2.0 authentication',
    references: [
      {
        sourceId: 'src-1',
        chunkIds: ['chunk-1-3']
      }
    ],
    tags: ['api', 'authentication']
  },
  {
    id: 'q-4',
    type: 'citation',
    difficulty: 'hard',
    text: 'What is the rate limit for API requests? Please provide the exact source.',
    expectedAnswer: 'Rate limiting is set to 1000 requests per hour (from API Authentication section)',
    references: [
      {
        sourceId: 'src-1',
        chunkIds: ['chunk-1-3']
      }
    ],
    tags: ['api', 'limits']
  },
  {
    id: 'q-5',
    type: 'open',
    difficulty: 'medium',
    text: 'How can a user reset their password?',
    expectedAnswer: 'Click "Forgot Password" link on login page and follow email instructions',
    references: [
      {
        sourceId: 'src-2',
        chunkIds: ['chunk-2-1']
      }
    ],
    tags: ['account', 'password']
  }
];

// Mock chatbot responses for demo
export const mockChatbotResponses: Record<string, any> = {
  'q-1': {
    answer: 'The product provides advanced analytics capabilities including real-time data processing, comprehensive dashboard insights, user behavior tracking, conversion rate analysis, and performance metrics monitoring.',
    citations: [
      {
        sourceId: 'src-1',
        chunkId: 'chunk-1-1',
        quote: 'advanced analytics capabilities with real-time data processing'
      }
    ],
    meta: { tokensIn: 15, tokensOut: 45, model: 'gpt-4' }
  },
  'q-2': {
    answer: 'Node.js 16',
    meta: { tokensIn: 12, tokensOut: 3, model: 'gpt-4' }
  },
  'q-3': {
    answer: 'True. The API endpoints are secured using OAuth 2.0 authentication protocol.',
    citations: [
      {
        sourceId: 'src-1',
        chunkId: 'chunk-1-3',
        quote: 'API endpoints are secured with OAuth 2.0 authentication'
      }
    ],
    meta: { tokensIn: 10, tokensOut: 15, model: 'gpt-4' }
  },
  'q-4': {
    answer: 'The API rate limit is 1000 requests per hour.',
    citations: [
      {
        sourceId: 'src-1',
        chunkId: 'chunk-1-3',
        quote: 'Rate limiting is set to 1000 requests per hour'
      }
    ],
    meta: { tokensIn: 18, tokensOut: 12, model: 'gpt-4' }
  },
  'q-5': {
    answer: 'To reset your password, click on the "Forgot Password" link on the login page and follow the instructions that will be sent to your registered email address.',
    citations: [
      {
        sourceId: 'src-2',
        chunkId: 'chunk-2-1',
        quote: 'Click on the "Forgot Password" link on the login page and follow the instructions sent to your registered email address'
      }
    ],
    meta: { tokensIn: 8, tokensOut: 32, model: 'gpt-4' }
  }
};

export function seedMockData() {
  return {
    sources: mockSources,
    questions: mockQuestions
  };
}