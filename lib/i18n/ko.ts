/**
 * Korean UI catalogue.
 *
 * Keys are the English source strings (see lib/i18n/index.ts) — an entry that
 * goes missing renders English rather than breaking. Sections mirror the
 * dashboard's own shape so a string is findable from the screen it appears on.
 *
 * Style: 해요체 for anything addressed to the owner ("검토해 주세요"), plain
 * noun phrases for labels and nav. Product nouns that Korean marketers use in
 * English stay English — SEO, CTA, RSS, API — because translating them reads
 * as less fluent, not more.
 */
export const KO: Record<string, string> = {
  /* ── nav + shell ─────────────────────────────────────────────────────── */
  'Home': '홈',
  'Strategy': '전략',
  'Write': '글쓰기',
  'Pipeline': '파이프라인',
  'Calendar': '캘린더',
  'Analytics': '분석',
  'Brand voice': '브랜드 보이스',
  'Social': '소셜',
  'Embed': '임베드',
  'Content API': '콘텐츠 API',
  'Billing': '결제',
  'Feedback': '피드백',
  'Toggle navigation': '메뉴 열기',
  'Manage billing': '결제 관리',

  /* ── account menu ────────────────────────────────────────────────────── */
  'Account': '계정',
  'Signed in': '로그인 계정',
  'Billing & plan': '결제 및 플랜',
  'Admin overview': '관리자 개요',
  'Visit your site ↗': '내 사이트 열기 ↗',
  'Grove home page ↗': 'grove 홈 ↗',
  'Log out': '로그아웃',
  'Logging out…': '로그아웃 중…',
  'Language': '언어',
  'Partly translated — the rest stays in English': '일부만 번역되어 있습니다. 나머지는 영어로 표시돼요.',

  /* ── site switcher ───────────────────────────────────────────────────── */
  'Your sites': '내 사이트',
  'Connect another website': '다른 사이트 연결',
  'No site yet': '아직 사이트가 없어요',

  /* ── autopilot + publishing mode ─────────────────────────────────────── */
  'Autopilot on': '자동 발행 켜짐',
  'Autopilot off': '자동 발행 꺼짐',
  'Publishing': '발행',
  'Cadence': '발행 주기',
  'Publish bar': '발행 기준',
  'Auto': '자동',
  'Manual': '수동',
  'Minimum quality score to auto-publish': '자동 발행에 필요한 최소 품질 점수',
  'Publishes almost everything — only broken drafts are held': '거의 모든 글을 발행합니다. 문제가 있는 초안만 보류돼요.',
  'Only solid drafts auto-publish — more go to review': '완성도 높은 글만 자동 발행하고, 나머지는 검토로 넘어갑니다.',
  'Only excellent drafts auto-publish — most go to review': '아주 뛰어난 글만 자동 발행하고, 대부분은 검토로 넘어갑니다.',
  'Posts publish automatically on schedule': '예약된 일정에 맞춰 자동으로 발행됩니다',
  'Posts go to the review queue for approval': '발행 전에 검토 대기열로 들어갑니다',
  'Skips weak drafts; publishes the rest (recommended)': '완성도가 낮은 초안만 걸러내고 나머지는 발행합니다 (권장)',
  'Fatal issues (bad facts, thin or broken content) always go to review.': '치명적인 문제(사실 오류, 빈약하거나 깨진 글)는 항상 검토로 넘어갑니다.',

  /* ── search ──────────────────────────────────────────────────────────── */
  'Search your articles…': '내 글 검색…',
  'Search your articles': '내 글 검색',
  'Clear search': '검색어 지우기',
  'Article search results': '글 검색 결과',
  'Keep typing to search your articles…': '계속 입력하면 글을 찾아드려요…',
  'In review': '검토 중',

  /* ── assistant panel ─────────────────────────────────────────────────── */
  'Agent': '에이전트',
  'New chat': '새 대화',
  'Open agent chat': '에이전트 대화 열기',
  'Close agent chat': '에이전트 대화 닫기',
  'Chat history': '대화 기록',
  'Delete chat': '대화 삭제',
  'Send': '보내기',
  'Changes': '변경 사항',
  'Do it:': '실행:',
  'Ask me anything about your blog — traffic, the plan, setup — or tell me to write something.':
    '블로그에 대해 무엇이든 물어보세요. 유입, 이번 달 계획, 설정은 물론 글을 써 달라고 하셔도 됩니다.',
  'Ask, or type / for commands…': '질문하거나 /를 입력해 명령을 보세요…',
  'Add follow up…': '이어서 질문하기…',
  'Something went wrong — nothing was changed. Try again in a moment.':
    '문제가 생겼습니다. 변경된 내용은 없어요. 잠시 후 다시 시도해 주세요.',
  'Undo failed — you can still restore titles by hand in the editor.':
    '되돌리지 못했습니다. 편집기에서 제목을 직접 수정할 수 있어요.',

  /* ── onboarding bell + activity ──────────────────────────────────────── */
  'Get set up': '설정 마치기',
  'Next': '다음',
  'Optional': '선택',
  'Activity': '활동',
  'Notifications': '알림',
  'No activity yet — queue a topic and the pipeline starts working.':
    '아직 활동이 없습니다. 주제를 등록하면 파이프라인이 움직이기 시작해요.',

  /* ── upsell ──────────────────────────────────────────────────────────── */
  'See plans →': '플랜 보기 →',
  'Not now': '나중에',
  'Close': '닫기',
  'Autopilot is a paid feature': '자동 발행은 유료 기능입니다',
  'Let grove research, write & publish this for you': 'grove가 조사하고, 쓰고, 발행까지 대신합니다',
  'The writing desk is a paid feature': '글쓰기 기능은 유료입니다',
  'Turn any idea into a finished, SEO-ready post': '아이디어 하나를 SEO까지 갖춘 완성된 글로 바꿔드립니다',
  'Programmatic SEO is a paid feature': '프로그래매틱 SEO는 유료 기능입니다',
  'Ship one page per real search, at scale': '실제 검색어 하나당 한 페이지씩, 대규모로 발행하세요',
  'The agent is a paid feature': '에이전트는 유료 기능입니다',
  'Put your marketing agent to work': '마케팅 에이전트에게 일을 맡기세요',
  'Generation is a paid feature': '글 생성은 유료 기능입니다',
  'Re-run this draft through the pipeline': '이 초안을 파이프라인에 다시 태웁니다',
  'Retrying re-researches and re-writes with fresh SERP data. Start a plan to run it.':
    '다시 시도하면 최신 검색 결과로 조사와 집필을 새로 합니다. 플랜을 시작하면 실행할 수 있어요.',
  'AI editing is a paid feature': 'AI 편집은 유료 기능입니다',
  'Rewrite any section in one click': '어떤 문단이든 한 번의 클릭으로 다시 씁니다',
  'Publishing is a paid feature': '발행은 유료 기능입니다',
  'Push this live to your blog': '이 글을 블로그에 바로 올립니다',
  'Publishing sends the post to your hosted blog and cross-posts the social variants. Start a plan to go live.':
    '발행하면 블로그에 글이 올라가고 소셜 버전도 함께 게시됩니다. 플랜을 시작하면 사용할 수 있어요.',

  /* ── home: agent insight ─────────────────────────────────────────────── */
  'Agent insight': '에이전트 제안',
  'Review plan': '플랜 검토',
  'Build the cluster': '클러스터 만들기',
  'Finding related searches…': '연관 검색어를 찾는 중…',
  'I need your site profile before I can plan a cluster.': '클러스터를 계획하려면 사이트 프로필이 먼저 필요합니다.',
  'An active plan is required to generate content.': '콘텐츠를 생성하려면 활성 플랜이 필요합니다.',
  'Couldn’t find enough related searches to cluster around this one.': '이 주제로 묶을 만한 연관 검색어를 충분히 찾지 못했습니다.',
  'Something went wrong. Try again.': '문제가 발생했습니다. 다시 시도해 주세요.',
  'Generation failed — nothing was written.': '생성에 실패했습니다. 작성된 글은 없어요.',

  /* ── home: pipeline table ────────────────────────────────────────────── */
  'Content pipeline': '콘텐츠 파이프라인',
  'View all →': '전체 보기 →',
  'Post': '글',
  'Target keyword': '타깃 키워드',
  'Words': '분량',
  'Status': '상태',
  'Schedule': '일정',
  'Nothing here yet.': '아직 아무것도 없습니다.',
  'Recent': '최근',
  'Scheduled': '예약됨',
  'locked': '잠김',
  'Published': '발행됨',
  'Publishing|status': '발행 중',
  'Live': '게시됨',
  'Drafting': '집필 중',
  'Failed': '실패',
  'Preview': '미리보기',

  /* ── home: queue a topic ─────────────────────────────────────────────── */
  'Grove suggests · from your strategy & live SERP': 'grove 추천 · 전략과 실시간 검색 결과 기반',
  'Couldn’t generate suggestions — build the site profile first.': '추천을 만들지 못했습니다. 사이트 프로필을 먼저 만들어 주세요.',
  'Open the writing desk →': '글쓰기 화면 열기 →',
  'Queue topic': '주제 등록',
  'Suggest': '추천받기',
  'Thinking…': '생각하는 중…',

  /* ── post row ────────────────────────────────────────────────────────── */
  'Publishes': '발행 예정',
  'View ↗': '보기 ↗',
  'Approve': '승인',
  'Re-run check': '검사 다시 실행',
  'Retry': '다시 시도',
  'Retrying…': '다시 시도하는 중…',
  'Regenerate': '다시 생성',
  'Delete': '삭제',
  'Unknown error': '알 수 없는 오류',
  'Crawling your site…': '사이트를 살펴보는 중…',
  'Searching the web…': '웹을 검색하는 중…',
  'Picking an angle…': '관점을 정하는 중…',
  'Drafting the article…': '초안을 쓰는 중…',
  'Saving draft…': '초안을 저장하는 중…',
  'Finding cover image…': '커버 이미지를 찾는 중…',
  'Gathering sources…': '자료를 모으는 중…',
  'Researching live SERP…': '실시간 검색 결과를 조사하는 중…',
  'Working…': '작업 중…',
  'Queued': '대기 중',
  'Delete this post?': '이 글을 삭제할까요?',
  'Rewrite this article from scratch? This replaces the current draft.': '이 글을 처음부터 다시 쓸까요? 현재 초안은 대체됩니다.',

  /* ── ghost pipeline (pre-plan preview) ───────────────────────────────── */
  'These are real topics grove found for your site. Start a plan and it researches, drafts & publishes them for you.':
    'grove가 이 사이트를 보고 실제로 찾아낸 주제입니다. 플랜을 시작하면 조사, 집필, 발행까지 대신합니다.',
  'Unlock autopilot →': '자동 발행 시작하기 →',
  'Researching': '조사 중',
  'Quality gate': '품질 검사',
  'Ready to publish': '발행 준비 완료',
};
