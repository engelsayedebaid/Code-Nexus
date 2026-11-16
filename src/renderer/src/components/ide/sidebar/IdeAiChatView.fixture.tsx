import { defineFixture } from '../../../component-fixtures/component-fixture'
import { useIdeAgentStore } from '@/store/ide-agent/ide-agent-store'
import type {
  IdeConversation,
  IdeConversationSummary
} from '../../../../../shared/ide-agent/ide-agent-types'
import { IdeAiChatView } from './IdeAiChatView'
import { IdeChatHeader } from './IdeChatHeader'

const NOW = Date.now()

const conversation: IdeConversation = {
  id: 'conv-1',
  workspaceKey: 'ws-1',
  workspacePath: 'C:\\Users\\demo\\Desktop\\orca',
  title: 'Refactor sidebar layout',
  mode: 'agent',
  agentId: 'codex',
  modelId: 'gpt-5-codex',
  multiAgentEnabled: false,
  followAgent: true,
  activePlanId: null,
  activeRunId: null,
  status: 'completed',
  createdAt: NOW - 3600_000,
  updatedAt: NOW - 60_000,
  messages: [
    {
      id: 'm1',
      conversationId: 'conv-1',
      role: 'user',
      mode: 'agent',
      text: 'Can you clean up the IDE sidebar? It feels cluttered.',
      createdAt: NOW - 3500_000,
      updatedAt: NOW - 3500_000
    },
    {
      id: 'm2',
      conversationId: 'conv-1',
      role: 'assistant',
      mode: 'agent',
      text: 'Here is a tighter layout for the panel:\n\n- Group the header controls into one strip\n- Move history into a slim rail\n- Keep the composer compact\n\n```ts\nconst rail = conversations.slice(0, 8)\n```\n\nWant me to apply it?',
      createdAt: NOW - 3400_000,
      updatedAt: NOW - 3000_000
    }
  ],
  plans: [],
  activity: [],
  fileChanges: [],
  checkpoints: [],
  commandExecutions: [],
  pendingPermissions: []
}

const summaries: IdeConversationSummary[] = [
  {
    id: 'conv-1',
    workspaceKey: 'ws-1',
    title: 'Refactor sidebar layout',
    mode: 'agent',
    agentId: 'codex',
    modelId: 'gpt-5-codex',
    status: 'completed',
    messageCount: 2,
    updatedAt: NOW - 60_000,
    createdAt: NOW - 3600_000
  },
  {
    id: 'conv-2',
    workspaceKey: 'ws-1',
    title: 'Explain the runtime RPC layer',
    mode: 'ask',
    agentId: 'codex',
    modelId: 'gpt-5-codex',
    status: 'idle',
    messageCount: 6,
    updatedAt: NOW - 7200_000,
    createdAt: NOW - 8000_000
  },
  {
    id: 'conv-3',
    workspaceKey: 'ws-1',
    title: 'Fix login redirect bug',
    mode: 'plan',
    agentId: 'claude',
    modelId: 'claude-sonnet-4',
    status: 'idle',
    messageCount: 4,
    updatedAt: NOW - 86_400_000,
    createdAt: NOW - 90_000_000
  }
]

function seedStore(active: IdeConversation | null): void {
  useIdeAgentStore.setState({
    conversations: summaries,
    activeConversation: active,
    draftsByConversation: {},
    attachmentsByConversation: {}
  })
}

const baseProps = {
  providers: [],
  workspaceKey: 'ws-1',
  workspacePath: 'C:\\Users\\demo\\Desktop\\orca',
  worktreeSelector: 'main',
  worktreeId: 'wt-1'
}

export const withMessages = defineFixture({
  width: 460,
  setup: () => seedStore(conversation),
  render: () => <IdeAiChatView {...baseProps} conversation={conversation} />
})

const planAndClarificationConversation: IdeConversation = {
  ...conversation,
  id: 'conv-plan-ar',
  title: 'bulid porfilo now html ,css',
  activePlanId: 'plan-1',
  status: 'awaiting_approval',
  plans: [
    {
      id: 'plan-1',
      conversationId: 'conv-plan-ar',
      version: 1,
      planHash: 'a1b2c3d4e5f60708',
      intro:
        'جهّزت لك خطة بسيطة لبناء موقع البورتفوليو بملفَي `index.html` و`styles.css` بحيث يظهر بشكل أنيق ومتجاوب على الموبايل والكمبيوتر.',
      objective: 'بناء موقع بورتفوليو شخصي متجاوب باستخدام HTML و CSS',
      requestSummary: 'bulid porfilo now html ,css',
      affectedFiles: [
        { path: 'index.html', action: 'create', summary: 'الهيكل والأقسام الرئيسية' },
        { path: 'styles.css', action: 'create', summary: 'التصميم والألوان والتجاوب' }
      ],
      steps: [
        {
          id: 's1',
          index: 0,
          title: 'إنشاء هيكل الصفحة (نبذة، مهارات، مشاريع، تواصل)',
          detail: 'كتابة أقسام HTML دلالية واضحة مع شريط تنقل علوي.',
          targetFiles: ['index.html'],
          status: 'pending'
        },
        {
          id: 's2',
          index: 1,
          title: 'تنسيق الواجهة وتجاوب الشاشات في CSS',
          detail: 'تطبيق شبكة مرنة وألوان هادئة متوافقة مع الموبايل والكمبيوتر.',
          targetFiles: ['styles.css'],
          status: 'pending'
        }
      ],
      risks: [],
      testsAndVerification: [
        'فتح index.html في المتصفح والتأكد من تحميل styles.css بدون أخطاء.',
        'مراجعة عرض الصفحة على مقاس الموبايل (375px) وسطح المكتب.'
      ],
      estimatedComplexity: 'low',
      status: 'awaiting_approval',
      createdAt: NOW - 120_000,
      updatedAt: NOW - 120_000,
      approvalRecord: null,
      revisionNotes: []
    }
  ],
  messages: [
    {
      id: 'pm1',
      conversationId: 'conv-plan-ar',
      role: 'user',
      mode: 'agent',
      text: 'bulid porfilo now html ,css',
      createdAt: NOW - 130_000,
      updatedAt: NOW - 130_000
    },
    {
      id: 'pm2',
      conversationId: 'conv-plan-ar',
      role: 'assistant',
      mode: 'agent',
      agentId: 'codex',
      modelId: 'gpt-5-codex',
      planId: 'plan-1',
      text: 'جهّزت لك خطة بسيطة لبناء موقع البورتفوليو بملفَي `index.html` و`styles.css` بحيث يظهر بشكل أنيق ومتجاوب على الموبايل والكمبيوتر.',
      createdAt: NOW - 120_000,
      updatedAt: NOW - 120_000
    },
    {
      id: 'pm3',
      conversationId: 'conv-plan-ar',
      role: 'user',
      mode: 'agent',
      text: 'مش فاهم وضح',
      createdAt: NOW - 60_000,
      updatedAt: NOW - 60_000
    },
    {
      id: 'pm4',
      conversationId: 'conv-plan-ar',
      role: 'assistant',
      mode: 'ask',
      agentId: 'codex',
      modelId: 'gpt-5-codex',
      text: 'بكل بساطة، قبل ما أعدّل أو أنشئ أي ملفات في مشروعك جهّزت خطة سريعة من خطوتين:\n\n- **`index.html`**: يحتوي على أقسام موقعك (تعريف بك، المهارات، المشاريع، ووسائل التواصل).\n- **`styles.css`**: يضبط الشكل والألوان بحيث يشتغل الموقع بشكل ممتاز على الموبايل والكمبيوتر.\n\nلو الخطة مناسبة اضغط **موافقة وتنفيذ** في الكارت بالأعلى وسأبدأ فورًا، أو اكتب أي تعديل تريده.',
      createdAt: NOW - 40_000,
      updatedAt: NOW - 40_000
    }
  ]
}

export const planAndArabicClarification = defineFixture({
  width: 460,
  setup: () => seedStore(planAndClarificationConversation),
  render: () => (
    <div className="space-y-2">
      <IdeChatHeader
        conversation={planAndClarificationConversation}
        conversations={summaries}
        providersLoading={false}
        workspaceKey="ws-1"
        workspacePath="C:\\Users\\demo\\Desktop\\orca"
        worktreeSelector="main"
      />
      <IdeAiChatView {...baseProps} conversation={planAndClarificationConversation} />
    </div>
  )
})

export const emptyState = defineFixture({
  width: 460,
  setup: () => seedStore(null),
  render: () => <IdeAiChatView {...baseProps} conversation={null} />
})

export const header = defineFixture({
  width: 460,
  setup: () => seedStore(conversation),
  render: () => (
    <IdeChatHeader
      conversation={conversation}
      conversations={summaries}
      providersLoading={false}
      workspaceKey="ws-1"
      workspacePath="C:\\Users\\demo\\Desktop\\orca"
      worktreeSelector="main"
    />
  )
})
