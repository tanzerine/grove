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
  'Researching live SERP': '실시간 검색 결과 조사',
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

  /* ── agent brief (dashboard home + weekly digest) ────────────────────── */
  'No articles yet. Queue a topic below and I get to work immediately — research, draft, quality check, publish.':
    '아직 발행한 글이 없습니다. 아래에서 주제를 등록하면 바로 조사, 집필, 품질 검사, 발행까지 진행할게요.',
  'I\'m drafting your first article right now.': '지금 첫 번째 글을 쓰고 있습니다.',
  'I\'m drafting your first {n} articles right now.': '지금 첫 글 {n}편을 쓰고 있습니다.',
  '1 draft is ready for your review.': '초안 1편이 검토를 기다리고 있어요.',
  '{n} drafts are ready for your review.': '초안 {n}편이 검토를 기다리고 있어요.',
  'First publish is scheduled — readers incoming.': '첫 발행이 예약되어 있습니다. 곧 독자가 들어와요.',
  'I published 1 new article this week.': '이번 주에 새 글 1편을 발행했습니다.',
  'I published {n} new articles this week.': '이번 주에 새 글 {n}편을 발행했습니다.',
  'No new articles went out this week.': '이번 주에는 새로 발행한 글이 없습니다.',
  '{n} reads — up {pct}% on last week.': '조회 {n}회로 지난주보다 {pct}% 늘었습니다.',
  '{n} reads — down {pct}% from last week.': '조회 {n}회로 지난주보다 {pct}% 줄었습니다.',
  '{n} reads — steady with last week.': '조회 {n}회로 지난주와 비슷합니다.',
  '{n} reads — your first readers.': '조회 {n}회 — 첫 독자가 들어왔습니다.',
  '{n} of them clicked through to {host}.': '그중 {n}명이 {host}으로 이동했습니다.',
  'Search engines drove {pct}% of readers.': '독자의 {pct}%가 검색을 통해 들어왔습니다.',
  'Best performer: “{title}” ({n} reads).': '가장 잘 읽힌 글: “{title}” (조회 {n}회).',
  'No reads recorded this week yet — search traffic usually takes a few weeks to compound after publishing.':
    '이번 주 조회는 아직 없습니다. 검색 유입은 보통 발행 후 몇 주에 걸쳐 쌓입니다.',
  '1 article in the works.': '글 1편을 작업 중입니다.',
  '{n} articles in the works.': '글 {n}편을 작업 중입니다.',
  'Review 1 waiting draft →': '대기 중인 초안 1편 검토하기 →',
  'Review {n} waiting drafts →': '대기 중인 초안 {n}편 검토하기 →',

  /* ── dashboard home ──────────────────────────────────────────────────── */
  'Overview': '개요',
  'Good morning': '좋은 아침입니다',
  'Good afternoon': '안녕하세요',
  'Good evening': '좋은 저녁입니다',
  'Your agent is running. Queue a topic and the pipeline starts immediately.':
    '에이전트가 작동 중입니다. 주제를 등록하면 파이프라인이 바로 시작돼요.',
  'Publishing calendar': '발행 캘린더',
  'When each post goes live, and where it is now': '각 글이 언제 나가고 지금 어디까지 왔는지',
  'Open calendar →': '캘린더 열기 →',
  'Your marketing agent': '내 마케팅 에이전트',
  'Working on now': '지금 작업 중',
  'Cross-post queue': '크로스포스팅 대기열',
  'One brief, every channel': '하나의 원고, 모든 채널로',
  'Connect channels →': '채널 연결하기 →',
  'Top queries': '주요 검색어',
  'Connect Search Console →': 'Search Console 연결하기 →',
  'Recent activity': '최근 활동',
  'Search clicks': '검색 클릭',
  'Total reads': '전체 조회',
  'Posts published': '발행한 글',
  'In pipeline': '파이프라인',
  'Awaiting review': '검토 대기',
  'Planned post': '예정된 글',
  'Draft': '초안',
  'Planned': '예정',
  'Review': '검토',
  'Fix': '해결하기',
  'Hold': '보류',
  'Blog post': '블로그 글',
  'X thread': 'X 스레드',
  'Dry run': '테스트 실행',
  'Off': '꺼짐',
  'Next in the queue': '다음 순서',
  'All caught up': '모두 처리했습니다',
  'No drafts in flight right now': '지금 작업 중인 초안이 없습니다',
  'Drafting in your voice': '브랜드 목소리로 집필 중',
  'Approve to let autopilot publish them': '승인하면 자동으로 발행됩니다',
  'The last share failed — check the connection': '마지막 공유가 실패했습니다. 연결을 확인해 주세요',
  'Your agent is ready — queue a topic to begin': '에이전트가 준비됐습니다. 주제를 등록해 시작하세요',
  'I’m working through your plan — researching, drafting, and holding finished drafts for your sign-off.':
    '계획대로 진행 중입니다. 조사하고, 초안을 쓰고, 완성된 글은 승인해 주실 때까지 보관해 둘게요.',
  'Ready to go. Queue your first topic (or flip on autopilot) and I’ll start researching and drafting right away.':
    '준비됐습니다. 첫 주제를 등록하거나 자동 발행을 켜주시면 바로 조사와 집필을 시작할게요.',
  'just now': '방금',
  'Yesterday': '어제',
  '{n} min ago': '{n}분 전',
  '1 hour ago': '1시간 전',
  '{n} hours ago': '{n}시간 전',
  '{n}d ago': '{n}일 전',
  'in {n}h': '{n}시간 후',
  'now': '지금',

  /* ── nav section heads ───────────────────────────────────────────────── */
  'Create': '만들기',
  'Publish': '발행',
  'Brand': '브랜드',

  /* ── analytics ───────────────────────────────────────────────────────── */
  'Export': '내보내기',
  'Performance report': '성과 리포트',
  'Example of what this report looks like once your blog is compounding.': '블로그가 자리를 잡으면 이런 리포트가 나옵니다.',
  'These are not your numbers.': '실제 데이터가 아닌 예시입니다.',
  'No performance data yet. Connect Search Console and publish your first articles — measurements land here as they come in.':
    '아직 성과 데이터가 없습니다. Search Console을 연결하고 첫 글을 발행하면 수치가 이곳에 쌓입니다.',
  'Nothing measured yet · connect Google to start': '측정된 데이터가 없습니다 · Google을 연결해 시작하세요',
  'Whole-site traffic': '사이트 전체 트래픽',
  'Pages by traffic': '트래픽 기준 페이지',
  'Page': '페이지',
  'Views': '조회수',
  'Users': '사용자',
  'Avg. time': '평균 체류시간',
  'Events': '이벤트',
  'Clicks & impressions from Google + answer engines': 'Google과 AI 검색에서의 클릭과 노출',
  'Clicks': '클릭',
  'Impressions': '노출',
  'Avg. CTR': '평균 CTR',
  'Avg. pos': '평균 순위',
  'Avg. position': '평균 순위',
  'CTR': 'CTR',
  'Organic clicks': '자연 유입 클릭',
  'AI referrals': 'AI 유입',
  'AI citations': 'AI 인용',
  'Answer engines': 'AI 검색 엔진',
  'Search Console hasn’t reported any days yet.': 'Search Console이 아직 데이터를 보내지 않았습니다.',
  'Your clicks and impressions will plot here.': '클릭과 노출이 이곳에 그려집니다.',
  'Where the clicks came from': '클릭이 들어온 경로',
  'Article performance': '글별 성과',
  'Top performing content': '성과가 좋은 콘텐츠',
  '1 published article': '발행한 글 1편',
  '{n} published articles': '발행한 글 {n}편',
  'Sample data': '예시 데이터',
  'Nothing published yet': '아직 발행한 글이 없습니다',
  'No published articles yet — they’ll appear here as the pipeline ships them.':
    '아직 발행한 글이 없습니다. 파이프라인이 글을 내보내면 이곳에 표시됩니다.',
  'Keyword positions on Google': 'Google 키워드 순위',
  'From a click to a signup': '클릭에서 가입까지',

  /* ── pipeline page ───────────────────────────────────────────────────── */
  'Next publish': '다음 발행',
  'Verify domain →': '도메인 인증하기 →',
  'Your marketing agent · last 7 days': '내 마케팅 에이전트 · 최근 7일',
  'No posts yet. Queue a topic above — the pipeline runs immediately.':
    '아직 글이 없습니다. 위에서 주제를 등록하면 파이프라인이 바로 실행됩니다.',
  'Why is this waiting for you?': '왜 검토가 필요한가요?',
  'A draft publishes on its own only when both gates pass:': '두 가지 관문을 모두 통과해야 자동으로 발행됩니다:',
  'In flight': '진행 중',
  'Needs your review': '검토 필요',
  'Needs attention': '확인 필요',
  'Site clicks': '사이트 클릭',
  'From search': '검색 유입',
  'AI-search ready': 'AI 검색 대응',
  'Waiting on you': '검토 대기',

  /* ── strategy ────────────────────────────────────────────────────────── */
  'the monthly plan your agent works from': '에이전트가 따라 움직이는 이번 달 계획',
  'Plan out of date': '계획이 오래되었습니다',
  'Verify this domain and the strategist can draft it.': '도메인을 인증하면 전략가가 계획을 세웁니다.',
  'North star': '핵심 목표',
  'Open the pipeline': '파이프라인 열기',
  'Edit goals': '목표 수정',
  'Objective & key results': '목표와 핵심 결과',
  'How grove will execute': 'grove가 실행하는 방식',
  'The tools the agent runs to ship this plan': '이 계획을 실행하기 위해 에이전트가 사용하는 도구',
  'Connect a domain first.': '먼저 도메인을 연결해 주세요.',
  'No strategy yet.': '아직 전략이 없습니다.',
  'Planned this month': '이번 달 계획',
  'Content pillars': '콘텐츠 축',
  'Estimated output': '예상 발행량',
  'Edit intent': '방향 수정',
  'Answer 5 questions →': '5가지 질문에 답하기 →',
  'Verify that you own this domain and the strategist will draft this month’s plan.':
    '도메인 소유를 인증하면 전략가가 이번 달 계획을 세웁니다.',
  'Your answers are saved — the strategist just hasn’t drafted the plan yet. Build it now, it takes about a minute.':
    '답변은 저장되어 있습니다. 아직 계획만 세우지 않았어요. 지금 만들면 1분 정도 걸립니다.',
  'Answer a few questions and the strategist will draft this month’s plan.':
    '몇 가지 질문에 답하면 전략가가 이번 달 계획을 세웁니다.',
  'Live SERP research': '실시간 검색 결과 조사',
  'Writer': '작가',
  'Manager': '관리자',
  'Crawls search results & competitor posts to find the ranking gaps worth taking.':
    '검색 결과와 경쟁 콘텐츠를 훑어 노려볼 만한 빈틈을 찾습니다.',
  'Drafts every post in your brand voice, structured for the target keyword.':
    '타깃 키워드에 맞춰 브랜드 목소리로 모든 글을 씁니다.',
  'Scores each draft 0–100 on strategy fit & craft, and gates publish.':
    '전략 적합도와 완성도를 0–100으로 채점하고 발행 여부를 결정합니다.',
  'Reads first-party events to grade the plan and tune next month.':
    '자체 수집한 지표로 계획을 평가하고 다음 달을 조정합니다.',
  'Nothing new ships this week — existing posts keep earning.':
    '이번 주에 새로 나가는 글은 없습니다. 기존 글이 계속 일합니다.',

  /* ── calendar ────────────────────────────────────────────────────────── */
  'Reschedule': '일정 변경',
  'Cancel': '취소',
  'Nothing scheduled this day.': '이 날짜에 예정된 글이 없습니다.',
  'Schedule a draft here:': '이 날짜에 초안 예약하기:',
  'Pick a day above, then choose a time to schedule.': '위에서 날짜를 고른 뒤 시간을 선택하세요.',
  'Save': '저장',
  'Saving…': '저장 중…',
  'Scheduling…': '예약하는 중…',

  /* ── writing desk ────────────────────────────────────────────────────── */
  'Start a draft': '초안 시작하기',
  'Blank page': '빈 페이지',
  'Idea studio': '아이디어 스튜디오',
  'SEO set': 'SEO 세트',
  'Give a seed term — grove drafts one focused page per real search, into your pipeline.':
    '키워드를 하나 주시면 실제 검색어마다 한 페이지씩 만들어 파이프라인에 넣습니다.',
  'Number of pages': '페이지 수',
  'Dismiss': '닫기',
  'Hide this — the draft stays in your pipeline': '숨기기 — 초안은 파이프라인에 그대로 남습니다',
  'A problem customers keep hitting': '고객이 반복해서 겪는 문제',
  'A question I get asked a lot': '자주 받는 질문',
  'Us vs. the alternative': '우리와 대안 비교',
  'A mistake beginners make': '초보자가 흔히 하는 실수',
  'Behind the scenes': '비하인드 스토리',
  'A strong opinion I hold': '확고한 내 생각',
  'Could not start that draft. Try again.': '초안을 시작하지 못했습니다. 다시 시도해 주세요.',
  'Generate ideas': '아이디어 만들기',
  'More ideas': '더 보기',
  'What\'s on your mind? (optional)': '어떤 이야기를 쓰고 싶으세요? (선택)',
  'In the pipeline': '파이프라인에서 작업 중',
  'On the page': '편집기에 열림',
  'Draft ready': '초안 완료',

  /* ── brand voice ─────────────────────────────────────────────────────── */
  'the context grove writes from': 'grove가 글을 쓸 때 참고하는 맥락',
  'Context grove uses for every article. The more accurate, the more on-brand the writing.':
    'grove가 모든 글에서 참고하는 정보입니다. 정확할수록 브랜드에 맞는 글이 나옵니다.',
  'No profile yet.': '아직 프로필이 없습니다.',
  'Crawl my site': '내 사이트 분석하기',
  'Language': '언어',
  'Products & services': '제품 및 서비스',
  'Target audience': '타깃 독자',
  'Value props': '핵심 가치',
  'Tone': '톤',
  'Vocabulary': '자주 쓰는 표현',
  'Sources': '참고 소스',
  'What grove reads before writing': 'grove가 글을 쓰기 전에 읽는 것',
  'No pages recorded': '기록된 페이지가 없습니다',
  'Synced': '동기화됨',
  'Business profile': '비즈니스 프로필',
  'Not connected': '연결되지 않음',

  /* ── published + feedback ────────────────────────────────────────────── */
  'Nothing published yet.': '아직 발행한 글이 없습니다.',
  'everything that’s live on your blog': '블로그에 게시된 모든 글',
  'Tell us the truth': '솔직하게 알려주세요',
  'Praise, shortcomings, or a complaint — it all reaches the owner': '칭찬이든 아쉬운 점이든 불만이든, 모두 운영자에게 전달됩니다',
  'Seen by the owner': '운영자가 확인함',

  /* ── draft review screen ─────────────────────────────────────────────── */
  'Reviewing draft': '초안 검토',
  'Pipeline timeline': '파이프라인 진행 기록',
  'Generation failed.': '생성에 실패했습니다.',
  'Built to rank on Google and get quoted by AI — written in your voice.':
    'Google 상위 노출과 AI 인용을 노리고, 브랜드 목소리로 썼습니다.',
  'Worth a look': '살펴볼 점',
  'AI-search readiness': 'AI 검색 대응도',
  'How ready this article is to be quoted by ChatGPT, Perplexity & Google AI Overviews.':
    'ChatGPT, Perplexity, Google AI 개요가 이 글을 인용할 준비가 얼마나 되었는지 보여줍니다.',
  'What’s ranking for this topic': '이 주제에서 상위에 오른 글',
  'Consensus subtopics from live top-ranking pages.': '상위 노출 페이지들이 공통으로 다루는 소주제입니다.',
  'Sources cited': '인용한 출처',
  'Manager quality score': '관리자 품질 점수',
  'Approved by the manager agent': '관리자 에이전트가 승인했습니다',
  'Sent back for rewrite': '재작성으로 돌려보냈습니다',
  'Rejected — routed to your review': '반려되어 검토로 넘어갔습니다',
  'Planned for': '예정일',

  /* ── upsell copy ─────────────────────────────────────────────────────── */
  'Your plan runs the full pipeline — live SERP research, on-brand drafting, a quality gate, and auto-publish to your blog. Start a plan to queue this topic.':
    '플랜을 시작하면 실시간 검색 조사, 브랜드 목소리 집필, 품질 검사, 블로그 자동 발행까지 전 과정이 돌아갑니다. 이 주제를 등록하려면 플랜을 시작하세요.',
  'grove drafts in your voice, adds internal links, and holds the result for your sign-off. Pick a plan to write your first one.':
    'grove가 브랜드 목소리로 쓰고, 내부 링크를 넣고, 승인해 주실 때까지 보관합니다. 플랜을 선택하면 첫 글을 쓸 수 있어요.',
  'grove plans a keyword set from live search demand and generates a page for each. Start a plan to build the set.':
    'grove가 실제 검색 수요에서 키워드 세트를 짜고 각각의 페이지를 만듭니다. 플랜을 시작하면 세트를 만들 수 있어요.',
  'Ask it to fix weak titles, build content clusters, or explain your numbers — and it executes. Start a plan to hand it the reins.':
    '약한 제목을 고치고, 콘텐츠 클러스터를 만들고, 수치를 설명해 달라고 하면 실제로 실행합니다. 플랜을 시작하고 맡겨보세요.',
  'grove revises the passage in your brand voice while keeping the rest intact. Start a plan to edit with AI.':
    'grove가 나머지는 그대로 두고 해당 문단만 브랜드 목소리로 다시 씁니다. 플랜을 시작하면 AI 편집을 쓸 수 있어요.',
  'LinkedIn': 'LinkedIn',

  /* ── embed page ──────────────────────────────────────────────────────── */
  'your blog, everywhere': '어디에나 놓는 내 블로그',
  'Your domain carries the SEO. Embeds are optional on top — they just show posts inside pages you already have.':
    'SEO는 내 도메인이 가져갑니다. 임베드는 그 위의 선택 사항으로, 이미 있는 페이지 안에 글을 보여줄 뿐입니다.',
  'Step 1 · Own the SEO': '1단계 · SEO를 내 것으로',
  'Step 3 · Make it yours': '3단계 · 내 스타일로',
  'Not needed': '필요 없음',
  'Connected': '연결됨',
  'Your blog is already on your own domain': '블로그가 이미 내 도메인에 있습니다',
  'Serve the blog on your own subdomain': '내 서브도메인에서 블로그 운영하기',
  'Point a subdomain at grove — we handle pages, canonicals, sitemap and search credit. Zero code.':
    '서브도메인을 grove로 연결하면 페이지, canonical, 사이트맵, 검색 신뢰도까지 저희가 처리합니다. 코드는 필요 없어요.',
  'Brand & destination': '브랜드와 연결 대상',
  'Colors — banner, buttons & accents': '색상 — 배너, 버튼, 포인트',
  'Advanced · serve articles yourself': '고급 · 글을 직접 서빙하기',
  'I already render articles on my own site — make those pages canonical':
    '이미 내 사이트에서 글을 렌더링하고 있습니다. 그 페이지를 canonical로 지정해 주세요',
  'Setup status': '설정 상태',
  'Articles in search': '검색에 노출되는 글',
  'Subdomain': '서브도메인',
  'Full blog embed': '블로그 전체 임베드',
  'Homepage widget': '홈페이지 위젯',
  'How embeds work': '임베드 작동 방식',
  'Under the hood': '내부 동작',
  'Customization attrs': '커스터마이징 속성',

  /* ── content API (MCP) ───────────────────────────────────────────────── */
  'Step 3 · Let it work': '3단계 · 작동시키기',
  'What your agent can do': '에이전트가 할 수 있는 일',
  'Needs write-back.': '쓰기 권한이 필요합니다.',
  'Advanced · test it by hand': '고급 · 직접 테스트하기',
  'On your site': '내 사이트에서',
  'Keep the beacon': '측정 코드는 남겨두세요',
  'Which one do I want?': '어떤 걸 골라야 하나요?',
  'No blog yet?': '아직 블로그가 없다면?',
  'Use Embed. One snippet, zero code, grove renders everything.':
    '임베드를 쓰세요. 스니펫 하나면 코드 없이 grove가 전부 렌더링합니다.',
  'Blog you like, want the posts inside it?': '마음에 드는 블로그가 있고, 그 안에 글을 넣고 싶다면?',
  'This page.': '이 페이지입니다.',
  'Nothing imported yet.': '아직 가져온 글이 없습니다.',

  /* ── weekly digest email ─────────────────────────────────────────────── */
  'Grove · weekly report': 'grove · 주간 리포트',
  'Your weekly Grove report — {host}': '{host} 주간 리포트',
  'Your weekly Grove report for {host}': '{host} 주간 grove 리포트',
  'Your Grove agent is getting started on {host}': '{host}에서 grove 에이전트가 일을 시작했습니다',
  '1 draft waiting + your weekly Grove report': '검토 대기 초안 1편 + 주간 grove 리포트',
  '{n} drafts waiting + your weekly Grove report': '검토 대기 초안 {n}편 + 주간 grove 리포트',
  '{host}: reads up {pct}% this week': '{host}: 이번 주 조회가 {pct}% 늘었습니다',
  '{host}: reads down {pct}% this week': '{host}: 이번 주 조회가 {pct}% 줄었습니다',
  'Reads this week': '이번 주 조회',
  'Clicks to your site': '사이트 클릭',
  'Published this week': '이번 주 발행',
  'steady vs last week': '지난주와 비슷',
  '▲ {pct}% vs last week': '▲ 지난주 대비 {pct}%',
  '▼ {pct}% vs last week': '▼ 지난주 대비 {pct}%',
  'your first readers': '첫 독자',
  'Review waiting drafts': '대기 중인 초안 검토하기',
  'Open your dashboard': '대시보드 열기',
  'Top post this week': '이번 주 최고 성과 글',
  'Top post: “{title}” — {n} reads': '최고 성과 글: “{title}” — 조회 {n}회',
  '“{title}” — {n} reads': '“{title}” — 조회 {n}회',
  'Don\'t want these? Turn off the weekly digest in your dashboard settings.':
    '받고 싶지 않으시면 대시보드 설정에서 주간 리포트를 꺼주세요.',

  /* ── social connections ──────────────────────────────────────────────── */
  'Social accounts': '소셜 계정',
  'Auto-share on publish': '발행 시 자동 공유',
  'Tokens are encrypted at rest. Disconnect any time — Grove keeps no copy after that.':
    '토큰은 암호화되어 저장됩니다. 언제든 연결을 해제할 수 있고, 해제 후에는 사본을 남기지 않습니다.',
  'Publish webhook': '발행 웹훅',
  'Remove': '삭제',
  'Connect': '연결',
  'Connecting…': '연결 중…',
  'Reconnect': '다시 연결',
  'Hide': '숨기기',
  'Reveal': '보기',
  'Connect an account or add a webhook below to enable.': '아래에서 계정을 연결하거나 웹훅을 추가하면 켤 수 있습니다.',
  'Connection cancelled.': '연결이 취소되었습니다.',
  'Connection expired or was tampered with. Try again.': '연결이 만료되었거나 변조되었습니다. 다시 시도해 주세요.',
  'Your session expired. Refresh and try again.': '세션이 만료되었습니다. 새로고침 후 다시 시도해 주세요.',
  'Enter a valid https:// URL.': '올바른 https:// 주소를 입력해 주세요.',
  'Could not clear the webhook.': '웹훅을 지우지 못했습니다.',
  'That platform isn\'t set up yet — its API keys are missing from the environment.':
    '이 플랫폼은 아직 설정되지 않았습니다. API 키가 등록되어 있지 않아요.',
  'Couldn\'t connect — the platform rejected the request. Try again.':
    '연결하지 못했습니다. 플랫폼이 요청을 거부했어요. 다시 시도해 주세요.',
  'Couldn\'t connect ({code}).': '연결하지 못했습니다 ({code}).',
  'Couldn\'t connect ({code}). Try again.': '연결하지 못했습니다 ({code}). 다시 시도해 주세요.',

  /* ── billing ─────────────────────────────────────────────────────────── */
  'Current plan': '현재 플랜',
  'CURRENT': '사용 중',
  'No active plan': '활성 플랜 없음',
  'Monthly': '월간',
  'Annual': '연간',
  'Choose plan': '플랜 선택',
  'Switch to this': '이 플랜으로 변경',
  'Redirecting…': '이동 중…',
  'Opening…': '여는 중…',
  'Something went wrong.': '문제가 발생했습니다.',
  'Payment received — your plan is being activated. It updates here within a few seconds.':
    '결제가 확인되었습니다. 플랜을 활성화하는 중이며 몇 초 안에 반영됩니다.',
  'Checkout canceled — no charge was made.': '결제가 취소되었습니다. 청구된 금액은 없습니다.',

  /* ── draft editor ────────────────────────────────────────────────────── */
  'Editing': '편집 중',
  'Edit draft': '초안 편집',
  'Discard': '되돌리기',
  'Discard your changes since the last save?': '마지막 저장 이후의 변경 사항을 되돌릴까요?',
  'Paragraph': '문단',
  'Ask grove': 'grove에게 요청',
  'Meta title': '메타 제목',
  'Meta description': '메타 설명',
  'Apply': '적용',
  'Applied to draft': '초안에 적용됨',
  'Dismissed': '적용하지 않음',
  'Untitled draft': '제목 없는 초안',
  'Select text, then ask grove to revise…': '문장을 선택한 뒤 grove에게 수정을 요청하세요…',
  'Make it punchier': '더 강렬하게',
  'Add a supporting stat': '근거 수치 추가',
  'Simplify': '쉽게 풀어쓰기',
  'Match my voice': '내 톤에 맞추기',
  'Tighten this': '군더더기 덜어내기',
  'Give the draft a title before scheduling it.': '예약하기 전에 초안 제목을 입력해 주세요.',
  'Could not save the draft — try again.': '초안을 저장하지 못했습니다. 다시 시도해 주세요.',
  'Could not update the draft — try again.': '초안을 수정하지 못했습니다. 다시 시도해 주세요.',
  'Save this draft first — then grove assist can revise a selection.':
    '먼저 초안을 저장하면 grove가 선택한 부분을 수정할 수 있습니다.',
  'Select a passage in the draft, then ask grove to revise it.': '초안에서 문단을 선택한 뒤 grove에게 수정을 요청하세요.',
  'Select a longer passage to revise.': '조금 더 긴 문단을 선택해 주세요.',
  'Add a domain first to upload images.': '이미지를 올리려면 먼저 도메인을 추가해 주세요.',
  'Could not upload that image.': '이미지를 올리지 못했습니다.',
  'Uploading your image…': '이미지를 올리는 중…',
  'Focus': '집중 모드',
  'Exit focus': '집중 모드 끄기',
  'Save draft': '초안 저장',
  'Save meta': '메타 저장',
  'Save & done': '저장하고 완료',
  'Done': '완료',

  /* ── social composer ─────────────────────────────────────────────────── */
  'Social posts': '소셜 게시물',
  'Connect an account': '계정 연결하기',
  'Sends URL, cover, and every channel’s copy to your endpoint.': '링크, 커버 이미지, 채널별 문구를 지정한 엔드포인트로 보냅니다.',
  'First line becomes the tweet; the link (23 chars on X) is appended. Over 280 is trimmed at a word break.':
    '첫 줄이 트윗이 되고 링크(X 기준 23자)가 뒤에 붙습니다. 280자를 넘으면 단어 단위로 잘립니다.',
  'Posted as-is with the article attached as a link card.': '작성한 그대로 게시되고 글은 링크 카드로 첨부됩니다.',
  'Over X’s limit — the tweet will be trimmed at a word break. Shorten the first line to control the cut.':
    'X 글자 수를 넘었습니다. 단어 단위로 잘리니 첫 줄을 줄여 잘리는 지점을 직접 정하세요.',
  'Regenerating replaces your edits. Continue?': '다시 생성하면 수정한 내용이 사라집니다. 계속할까요?',
  'Saving the copy failed — try again.': '문구를 저장하지 못했습니다. 다시 시도해 주세요.',
  'Copy saved.': '문구를 저장했습니다.',
  'Sharing failed: the request didn’t complete — try again.': '공유에 실패했습니다. 요청이 완료되지 않았어요. 다시 시도해 주세요.',
  'Save copy': '문구 저장',
  'Write social posts': '소셜 게시물 작성',
  'Regenerate all': '전체 다시 생성',
  'Writing…': '작성 중…',
  'Post now': '지금 게시',
  'Posting…': '게시하는 중…',
  'Sending…': '보내는 중…',
  'delivered': '전송됨',
  'sends when the article publishes': '글이 발행될 때 전송됩니다',

  /* ── feedback form ───────────────────────────────────────────────────── */
  'Send something else': '다른 내용 보내기',
  'How is Grove going overall?': 'grove는 전반적으로 어떠신가요?',
  'Choose one…': '하나를 선택하세요…',
  'How bad is it?': '얼마나 심각한가요?',
  'What stood out most?': '가장 좋았던 점은 무엇인가요?',
  'Which part of Grove?': 'grove의 어느 부분인가요?',
  'In your own words': '자유롭게 적어주세요',
  'Tell us what happened': '어떤 일이 있었는지 알려주세요',
  'This goes straight to Grove’s owner.': '이 내용은 grove 운영자에게 바로 전달됩니다.',
  'Credit it to': '이름 표기',
  'Your name': '이름',
  'Title & company': '직함과 회사',
  'Link to your site': '사이트 링크',
  'A one-line version': '한 줄 요약',
  'Something went wrong. Please try again.': '문제가 발생했습니다. 다시 시도해 주세요.',

  /* ── cancel / refund funnel ──────────────────────────────────────────── */
  'Request received': '요청이 접수되었습니다',
  'Never mind, keep my plan': '취소하지 않고 계속 사용하기',
  'Continue →': '계속 →',
  'What could we have done better?': '저희가 무엇을 더 잘할 수 있었을까요?',
  'Optional, but the most useful thing you can leave us.': '선택 사항이지만, 가장 도움이 되는 이야기입니다.',
  'What would bring you back?': '어떻게 하면 다시 사용하시겠어요?',
  'Confirm your refund request': '환불 요청 확인',
  'Request refund': '환불 요청',
  'Submitting…': '제출하는 중…',

  /* ── Google / Search Console ─────────────────────────────────────────── */
  'Google connected': 'Google 연결됨',
  'Connect Google': 'Google 연결',
  'Finish Google setup': 'Google 설정 마치기',
  'Checking your Search Console…': 'Search Console을 확인하는 중…',
  'One step left': '한 단계 남았습니다',
  'Add this': '아래 값을 추가하세요',
  'TXT record': 'TXT 레코드',
  'Value': '값',
  'DNS can take up to an hour.': 'DNS 반영에는 최대 한 시간이 걸립니다.',
  'Show the record again': '레코드 다시 보기',
  'I’ve added it — verify': '추가했습니다 — 확인하기',
  'Verifying…': '확인하는 중…',
  'Syncing…': '동기화 중…',
  'Refresh': '새로고침',
  'Copy': '복사',
  'Copied': '복사됨',
  'Something went wrong reaching Search Console. Try disconnecting and connecting again.':
    'Search Console에 연결하지 못했습니다. 연결을 해제한 뒤 다시 연결해 보세요.',
  'Search Console isn’t set up on this Grove instance yet.': '이 grove 인스턴스에는 Search Console이 아직 설정되지 않았습니다.',
  'DNS record not visible yet — it can take up to an hour. Try again shortly.':
    'DNS 레코드가 아직 보이지 않습니다. 최대 한 시간이 걸릴 수 있어요. 잠시 후 다시 시도해 주세요.',

  /* ── content API keys ────────────────────────────────────────────────── */
  'Step 1 · Create a key': '1단계 · 키 만들기',
  'Step 2 · Connect your agent': '2단계 · 에이전트 연결하기',
  'One key per agent': '에이전트마다 키 하나',
  'What is it for?': '어디에 쓰나요?',
  'All my sites': '내 모든 사이트',
  'Allow write-back': '쓰기 권한 허용',
  'Point it at grove': 'grove를 가리키게 하기',
  'Your keys': '내 키',
  'No keys yet.': '아직 키가 없습니다.',
  'Revoke': '폐기',
  'Create key': '키 만들기',
  'Creating…': '만드는 중…',
  'Content layer': '콘텐츠 레이어',
  'Could not create the key.': '키를 만들지 못했습니다.',
  'Could not reach grove. Try again.': 'grove에 연결하지 못했습니다. 다시 시도해 주세요.',

  /* ── embed tabs ──────────────────────────────────────────────────────── */
  'Step 2 · Show posts in your site': '2단계 · 내 사이트에 글 노출하기',
  'Copy-paste embeds': '복사해서 붙이는 임베드',
  'Full blog': '블로그 전체',
  'The whole blog, live inside /blog — search, filters, pagination, in-page reading. No code to maintain.':
    '/blog 안에서 블로그 전체가 돌아갑니다. 검색, 필터, 페이지 넘김, 페이지 내 읽기까지. 유지할 코드가 없습니다.',
  'A small teaser for your homepage: latest 3–4 posts and a "Read the blog →" link.':
    '홈페이지용 작은 미리보기: 최근 글 3~4편과 "블로그 보기 →" 링크.',
  'Visitors read in-page, so this alone won\'t get indexed — your subdomain from step 1 carries the SEO.':
    '방문자는 페이지 안에서 읽기 때문에 이것만으로는 색인되지 않습니다. SEO는 1단계의 서브도메인이 담당합니다.',
  'Set data-blog-url to wherever you mounted the full embed, or your subdomain from step 1.':
    'data-blog-url을 전체 임베드를 넣은 주소나 1단계의 서브도메인으로 설정하세요.',
  'Blog': '블로그',
  'Read the blog →': '블로그 보기 →',
  'Your latest post title lands here': '가장 최근 글 제목이 여기에 들어갑니다',
  'Featured · just now': '추천 · 방금',
  'Another recent article': '또 다른 최근 글',
  'A recent post shows up here': '최근 글이 여기에 표시됩니다',

  /* ── image studio ────────────────────────────────────────────────────── */
  'Add an image': '이미지 추가',
  'Close image tool': '이미지 도구 닫기',
  'Image source': '이미지 소스',
  'Upload': '업로드',
  'Uploading…': '업로드 중…',
  'Drop an image here, or click to choose one': '여기에 이미지를 놓거나 클릭해 선택하세요',
  'You can also paste an image, or drag one straight onto the page.': '이미지를 붙여넣거나 페이지로 바로 끌어다 놓아도 됩니다.',
  'Generate': '생성',
  'Drawing…': '그리는 중…',
  'Insert at cursor': '커서 위치에 삽입',
  'Inserted into the draft.': '초안에 삽입했습니다.',
  'Try another': '다른 이미지',
  'Could not generate an image. Try again.': '이미지를 만들지 못했습니다. 다시 시도해 주세요.',

  /* ── pillars + month calendar ────────────────────────────────────────── */
  'Add a pillar': '축 추가하기',
  'Clear focus ✕': '초점 해제 ✕',
  'Tell the strategist what else this month should cover and it reworks the plan.':
    '이번 달에 더 다뤄야 할 내용을 알려주면 전략가가 계획을 다시 짭니다.',
  'The month at a glance': '이번 달 한눈에 보기',
  'Research': '조사',

  /* ── scheduling + timeline ───────────────────────────────────────────── */
  'Publish this post': '이 글 발행하기',
  'Or pick a date and time': '또는 날짜와 시간을 고르세요',
  'Unschedule': '예약 해제',
  'Could not schedule this post.': '이 글을 예약하지 못했습니다.',
  'Could not clear the schedule.': '예약을 해제하지 못했습니다.',
  'How this was made': '어떻게 만들어졌나',
  'Waiting to start…': '시작을 기다리는 중…',
  'Crawl site': '사이트 분석',
  'Web search': '웹 검색',
  'Pick angle': '관점 선정',
  'Write article': '글 작성',
  'Cover image': '커버 이미지',
  'Show': '펼치기',
  'Planning cadence': '계획 주기',
  'Nothing scheduled in this window.': '이 기간에 예정된 글이 없습니다.',
  'Click to open the article →': '클릭하면 글이 열립니다 →',

  /* ── plan chat ───────────────────────────────────────────────────────── */
  'Talk to your strategist': '전략가와 대화하기',
  'Ask about the plan, or tell me what to change…': '계획에 대해 묻거나 바꾸고 싶은 점을 말씀해 주세요…',
  'Ask why the plan looks this way, or tell it what to change.': '왜 이런 계획인지 묻거나, 무엇을 바꿀지 알려주세요.',
  'Something went wrong — the plan is unchanged. Try again in a moment.':
    '문제가 발생했습니다. 계획은 그대로입니다. 잠시 후 다시 시도해 주세요.',
  'Hide earlier messages': '이전 메시지 숨기기',
  'Show less': '접기',
  'Show more': '더 보기',

  /* ── beta ────────────────────────────────────────────────────────────── */
  'Beta': '베타',
  'Tell us why': '이유를 알려주세요',
  'Have a beta code?': '베타 코드가 있으신가요?',
  'Redeem it →': '코드 등록하기 →',
  'Redeem a beta code': '베타 코드 등록',
  'Redeem': '등록',
  'Checking…': '확인하는 중…',
  'Beta codes give you a free run of Grove — no card, nothing to cancel.':
    '베타 코드로 grove를 무료로 사용해 보세요. 카드도, 해지할 것도 없습니다.',
  'That code could not be redeemed.': '이 코드는 등록할 수 없습니다.',

  /* ── embed forms ─────────────────────────────────────────────────────── */
  'Use': '사용',
  'Your blog is live at': '블로그 주소',
  'Check again': '다시 확인',
  'Enter a hostname first': '먼저 호스트명을 입력해 주세요',
  'Copy value': '값 복사',
  'Powered by your brand': '내 브랜드로 제공',
  'Try your product': '제품 사용해 보기',
  'Visit →': '바로가기 →',
  'Reset to crawled colors': '분석된 색상으로 되돌리기',
  'Save colors': '색상 저장',
  'Using your custom colors': '직접 지정한 색상을 사용 중',
  'Using colors from your site': '사이트에서 가져온 색상을 사용 중',

  /* ── misc ────────────────────────────────────────────────────────────── */
  'Add a domain first to start writing.': '글을 쓰려면 먼저 도메인을 추가해 주세요.',
  'cross-post every article to your channels': '모든 글을 내 채널에 함께 게시합니다',
  'Don’t render articles yourself? Proxy ours instead': '직접 렌더링하지 않으신다면, 저희 페이지를 프록시하세요',
  'One config block in your host and {url} serves grove’s pages from your own origin — same domain, so the SEO compounds into your apex instead of a subdomain. Set the canonical base above to {canonical} so the URLs grove emits match.':
    '호스팅 설정에 블록 하나만 추가하면 {url}이 내 도메인에서 grove 페이지를 서빙합니다. 같은 도메인이므로 SEO가 서브도메인이 아니라 대표 도메인에 쌓입니다. grove가 내보내는 URL이 일치하도록 위의 canonical 주소를 {canonical}로 설정하세요.',

  /* ── the leftovers: strings that had HTML entities in the source, or sat
        in a sentence split across elements, so the first pass never saw them ─ */
  'A feature, a price, a result…': '기능, 가격, 결과 무엇이든…',
  'Add access token': '액세스 토큰 추가',
  'Already server-rendering /blog/<slug> yourself? Point data-article-base there instead — only needed if that’s you.':
    '이미 /blog/<slug>를 직접 서버 렌더링하고 계신가요? 그렇다면 data-article-base를 그쪽으로 지정하세요. 해당되는 경우에만 필요합니다.',
  'Before you go — what\'s the main reason?': '떠나시기 전에 — 가장 큰 이유는 무엇인가요?',
  'Cancel & request a refund': '해지 및 환불 요청',
  'cancel & request a refund': '해지 및 환불 요청',
  'Copy it now — this is the only time it’s shown': '지금 복사하세요. 이 값은 지금만 표시됩니다',
  'Founder, Acme': '대표, Acme',
  'Generation is paused until the quota resets — upgrade below for more.':
    '할당량이 초기화될 때까지 생성이 중단됩니다. 더 필요하시면 아래에서 업그레이드하세요.',
  'Give grove a nudge and it\'ll suggest angles for': 'grove에 힌트를 주면 이런 관점을 제안합니다:',
  'How this month\'s plan is tracking against its targets': '이번 달 계획이 목표에 얼마나 다가갔는지',
  'If you leave this blank we\'ll quote what you wrote above, unedited.':
    '비워두시면 위에 적어주신 내용을 그대로 인용합니다.',
  'It’s a plain HTTP endpoint': '평범한 HTTP 엔드포인트입니다',
  'JSON-RPC over a single POST to': 'JSON-RPC를 다음 주소로 POST 한 번:',
  'Leave empty to keep the grove-hosted URLs canonical. Clearing the field switches back instantly.':
    '비워두면 grove가 호스팅하는 URL이 canonical로 유지됩니다. 지우면 곧바로 되돌아갑니다.',
  'Manager score, readiness & the pipeline log': '관리자 점수, 준비도, 파이프라인 로그',
  'Must be an https URL. Leave empty to send readers to your homepage.':
    'https 주소여야 합니다. 비워두면 독자를 홈페이지로 보냅니다.',
  'Only for sites with their own server-rendered': '다음을 직접 서버 렌더링하는 사이트에만 해당합니다:',
  'Pick a day on the calendar to see what\'s happening.': '캘린더에서 날짜를 고르면 그날의 일정이 보입니다.',
  'Register —': '어투 —',
  'Secure checkout by Stripe. Cancel anytime from': 'Stripe 보안 결제. 언제든 해지할 수 있습니다:',
  'Shown once, then stored only as a hash — grove can’t show it to you again. Revoke and make a new one if it goes missing.':
    '한 번만 표시되고 이후에는 해시로만 저장됩니다. grove도 다시 보여줄 수 없어요. 잃어버리면 폐기하고 새로 만드세요.',
  'Signing secret — verify the': '서명 시크릿 — 다음 값을 검증하세요:',
  'Target ·': '타깃 ·',
  'Tell us what worked and what didn\'t →': '좋았던 점과 아쉬웠던 점을 알려주세요 →',
  'The strategist is reading your site and your answers — about a minute.':
    '전략가가 사이트와 답변을 읽고 있습니다. 1분쯤 걸려요.',
  'Then add one line to': '그다음 이 파일에 한 줄만 추가하세요:',
  'Three posts a week without touching a draft.': '초안에 손대지 않고도 주 3편을 발행했습니다.',
  'View live': '게시된 글 보기',
  'We can\'t see the record yet — DNS changes can take up to an hour. Double-check the value, then verify again.':
    '아직 레코드가 보이지 않습니다. DNS 반영에는 최대 한 시간이 걸려요. 값을 다시 확인한 뒤 재시도해 주세요.',
  'What you\'ve sent': '보내신 내용',
  'Your plan & payments': '플랜과 결제',
  'a blank page — write it yourself, or start from Idea studio / SEO set on the right. Anything grove writes for you opens right here. Generate images from the toolbar, then pick when it publishes.':
    '빈 페이지입니다. 직접 쓰셔도 되고, 오른쪽의 아이디어 스튜디오나 SEO 세트에서 시작해도 됩니다. grove가 쓴 글도 모두 여기에서 열립니다. 툴바에서 이미지를 만들고, 발행 시점을 고르세요.',
  'autonomous · loop running': '자율 실행 · 루프 작동 중',
  'checking every few seconds…': '몇 초마다 확인하는 중…',
  'dry run': '테스트 실행',
  'each card shows the tools the agent runs to ship it': '각 카드에는 그 글을 내보내기 위해 에이전트가 쓰는 도구가 표시됩니다',
  'grading failed': '채점 실패',
  'grove assist': 'grove 어시스트',
  'grove is drawing — this takes a few seconds…': 'grove가 그리는 중입니다. 몇 초 걸려요…',
  'grove is writing…': 'grove가 쓰는 중…',
  'grove saves the draft and publishes it at that time, in your local timezone.':
    'grove가 초안을 저장했다가 현지 시간 기준 그 시각에 발행합니다.',
  'grove shipped': 'grove가 내보낸 글',
  'how the agent breaks the plan down': '에이전트가 계획을 어떻게 나누는지',
  'isn’t verified yet — autopilot is paused, but you can queue topics and review every draft.':
    '아직 인증되지 않았습니다. 자동 발행은 멈춰 있지만 주제를 등록하고 초안을 검토할 수는 있어요.',
  'links, table of contents & tags': '링크, 목차, 태그',
  'min score': '최소 점수',
  'not connected': '연결되지 않음',
  'not set up': '설정되지 않음',
  'now drive 24% of all clicks — up from 4% a quarter ago.': '지금은 전체 클릭의 24%를 차지합니다. 한 분기 전에는 4%였어요.',
  'on /blog': '/blog 에서',
  'or change your answers first': '또는 답변을 먼저 수정하세요',
  'or type another subdomain — you’ll add one DNS record either way.':
    '또는 다른 서브도메인을 입력하세요. 어느 쪽이든 DNS 레코드 하나만 추가하면 됩니다.',
  'position · clicks': '순위 · 클릭',
  'post manually after publishing': '발행 후 직접 게시',
  'route or reverse proxy. If that’s not you, step 1 above does everything with zero code.':
    '라우트나 리버스 프록시를 말합니다. 해당하지 않는다면 위의 1단계만으로 코드 없이 끝납니다.',
  'this week': '이번 주',
  'to enable.': '하면 켤 수 있습니다.',
  'to grade it (it re-scores the same draft, no rewrite).': '를 누르면 채점합니다 (같은 초안을 다시 채점하며, 새로 쓰지 않습니다).',
  'to restyle.': '를 수정하세요.',
  'what your layer has taken': '내 콘텐츠 레이어가 가져간 글',
  'what’s live right now': '지금 게시된 상태',
  'when each post goes live, and where it is now': '각 글이 언제 나가고 지금 어디까지 왔는지',
  'where the month\'s writing is aimed': '이번 달 글이 겨냥하는 방향',
  'won’t publish until approved': '승인 전에는 발행되지 않습니다',

  /* ── attribute strings that contained an apostrophe, which the first
        version of the unwrapped-string checker silently skipped ─────────── */
  "Add a topic… e.g. 'reduce churn with onboarding nudges'": '주제를 입력하세요… 예: \'온보딩 넛지로 이탈 줄이기\'',
  "Seed term — e.g. 'cold brew'": '시드 키워드 — 예: \'콜드브루\'',
  "No quality score — the manager's evaluation didn't run for this draft. It's held for your review by default.":
    '품질 점수가 없습니다. 이 초안은 관리자 평가가 실행되지 않아 기본적으로 검토 대기 상태입니다.',
  "The quality check hit an error (often a temporary provider outage) and didn't finish. Your draft is safe — use “Re-run check” to grade it.":
    '품질 검사가 오류로 끝나지 않았습니다 (대개 일시적인 제공자 장애입니다). 초안은 안전하게 보관되어 있으니 “검사 다시 실행”으로 채점하세요.',
  "The one thing that would've made Grove worth keeping…": 'grove를 계속 쓸 만하게 만들었을 단 한 가지…',
  "We're sorry to see you go": '떠나신다니 아쉽습니다',
  "What should the picture show? (blank = illustrate the section you're in)":
    '어떤 그림이 필요하신가요? (비워두면 지금 보고 있는 섹션을 그립니다)',
  "grove's articles, inside the blog you already run": '이미 운영 중인 블로그 안에 grove의 글을',

  /* ── plan chat (server-side replies) ─────────────────────────────────── */
  'I hit a snag processing that — the plan is unchanged. Try again in a moment.':
    '처리 중 문제가 생겼습니다. 계획은 그대로예요. 잠시 후 다시 시도해 주세요.',
  "This month's plan-revision budget is used up ({n} revisions). I can still answer questions about the plan, and the monthly re-plan on the 1st takes your notes into account.":
    '이번 달 계획 수정 횟수({n}회)를 모두 사용했습니다. 계획에 대한 질문에는 계속 답할 수 있고, 매월 1일 재수립 때 남기신 내용이 반영됩니다.',

  /* ── the site's language control (Brand voice) ───────────────────────── */
  'Switching…': '전환하는 중…',
  'Could not change the language — try again.': '언어를 변경하지 못했습니다. 다시 시도해 주세요.',
  'One setting for this site: what grove writes in — articles, FAQs, social posts, the plan — and what grove speaks to you in while you manage it. Applies the moment you pick. Research runs in this language too, so the sources cited are ones your readers can open. Already published articles stay as they are.':
    '이 사이트의 언어 설정 하나로 모두 정해집니다. grove가 쓰는 글, FAQ, 소셜 게시물, 계획은 물론 관리 화면에서 grove가 쓰는 언어까지 바뀝니다. 선택하는 즉시 적용돼요. 조사도 이 언어로 진행하므로 인용하는 자료는 독자가 열어볼 수 있는 것들입니다. 이미 발행한 글은 그대로 유지됩니다.',

  /* ── strategy hero + planning cadence ────────────────────────────────── */
  'Marketing agent': '마케팅 에이전트',
  "{host} · the agent's plan for {month}": '{host} · {month} 에이전트 계획',
  'Own {pillar} — {posts} posts, {conversion} built to convert.': '{pillar} 공략 — {posts}편 중 {conversion}편은 전환용입니다.',
  'Own {pillar} — {posts} posts building search authority.': '{pillar} 공략 — 검색 신뢰도를 쌓는 {posts}편.',
  'Ship 1 post and prove the channel.': '1편을 내보내 채널의 가능성을 확인합니다.',
  'Ship {n} posts and prove the channel.': '{n}편을 내보내 채널의 가능성을 확인합니다.',
  'The plan for this month is still being drafted.': '이번 달 계획을 아직 작성 중입니다.',
  'Pillars and slots land as soon as the strategist finishes planning.': '전략가가 계획을 마치는 대로 콘텐츠 축과 일정이 채워집니다.',
  '1 pillar': '콘텐츠 축 1개',
  '{n} pillars': '콘텐츠 축 {n}개',
  '{n} top-funnel': '인지 단계 {n}편',
  '{n} mid-funnel': '고려 단계 {n}편',
  '{n} conversion': '전환 단계 {n}편',
  'posts': '편',
  'words (est.)': '예상 글자수',
  '/ wk': '/ 주',
  'Target · {goal}': '목표 · {goal}',
  'Weekly': '주간',
  'Daily': '일간',
  'Week {n}': '{n}주차',
  'Week {n} · {month}': '{n}주차 · {month}',
  'Today · {date}': '오늘 · {date}',
  'Publish “{title}”': '“{title}” 발행',
  'Tracked by Analytics': '분석으로 측정',
  'You’re looking at your {month} plan. {current} hasn’t been built yet.':
    '지금 보고 계신 것은 {month} 계획입니다. {current} 계획은 아직 만들어지지 않았어요.',
  'Build {month}’s plan →': '{month} 계획 만들기 →',
  '{posts} posts mapped across {pillars} pillars — approve changes any time in the chat below.':
    '{pillars}개 축에 {posts}편을 배치했습니다. 아래 대화에서 언제든 수정할 수 있어요.',
  '1 run': '1회 실행',
  '{n} runs': '{n}회 실행',
  '1 draft': '초안 1편',
  '{n} drafts': '초안 {n}편',
  '1 review': '검토 1건',
  '{n} reviews': '검토 {n}건',
  'continuous': '상시',

  /* ── strategist thread ───────────────────────────────────────────────── */
  '1 message in this month’s thread': '이번 달 대화 1건',
  '{n} messages in this month’s thread': '이번 달 대화 {n}건',
  '1 plan change left': '수정 1회 남음',
  '{n} plan changes left': '수정 {n}회 남음',
  '1 plan change made': '수정 1회 반영됨',
  '{n} plan changes made': '수정 {n}회 반영됨',
  '1 earlier message': '이전 메시지 1건',
  '{n} earlier messages': '이전 메시지 {n}건',

  /* ── analytics ───────────────────────────────────────────────────────── */
  '{host} · how the blog is compounding': '{host} · 블로그가 쌓이는 추이',
  'Organic performance': '검색 유입 성과',
  'Traffic sources': '유입 경로',
  'Ranking distribution': '순위 분포',
  'Content funnel': '콘텐츠 퍼널',
  'Synced from Search Console & first-party events ·': 'Search Console과 자체 수집 데이터 기준 ·',
  'Google Analytics · every page, not just the blog ·': 'Google Analytics · 블로그뿐 아니라 모든 페이지 ·',
  'Positions 1–3': '1–3위',
  'Positions 4–10': '4–10위',
  'Positions 11–20': '11–20위',
  'Positions 21+': '21위 이하',
  'Clicks to blog': '블로그 클릭',
  'Read past 50%': '50% 이상 읽음',
  'Email captured': '이메일 확보',
  'Started trial': '체험 시작',
  'Page views': '페이지뷰',
  'Active users': '활성 사용자',
  'Avg. engagement': '평균 참여도',
  'Blog views': '블로그 조회',
  'Avg. time on page': '평균 체류시간',
  'Events tracked': '측정된 이벤트',
  'The SaaS founder’s guide to compounding traffic': 'SaaS 창업자를 위한 트래픽 복리 가이드',
  'How to write for answer engines': 'AI 검색에 맞춰 쓰는 법',
  '10 onboarding mistakes killing activation': '활성화를 망치는 온보딩 실수 10가지',
  'Programmatic SEO without a dev team': '개발팀 없이 하는 프로그래매틱 SEO',
  'How we cut SaaS churn 18% in a quarter': '한 분기에 SaaS 이탈률을 18% 줄인 방법',
  'The honest cost of an in-house content team': '사내 콘텐츠 팀의 실제 비용',

  /* ── the rest of the sweep ───────────────────────────────────────────── */
  'Beta codes': '베타 코드',
  'Cluster around “': '이 글을 중심으로 묶기 “',
  'Hub: “': '허브: “',
  'targets “': '타깃 “',
  'No past chats yet for': '아직 대화 기록이 없습니다:',
  'Thought ·': '생각 ·',
  'No article matches “': '일치하는 글이 없습니다 “',
  'Grove is ready to write for': 'grove가 글을 쓸 준비가 됐습니다:',
  'Prefer to write it yourself?': '직접 쓰고 싶으신가요?',
  'Manager quality score · last decision: {action}': '관리자 품질 점수 · 최근 판정: {action}',
  'Overall score {v} of 100': '종합 점수 100점 만점에 {v}점',
  'Plans from $': '플랜 시작가 $',
  'Not continuing?': '계속 사용하지 않으시나요?',
  'planned ·': '예정 ·',
  'Auto-posts a hook + link when an article publishes.': '글이 발행되면 후크와 링크를 자동으로 게시합니다.',
  'Shares the article as a LinkedIn post on your profile.': '내 프로필에 LinkedIn 게시물로 글을 공유합니다.',
  'Connected.': '연결됨.',
  'Connected as {handle}.': '{handle} 계정으로 연결됨.',
  'If your registrar says the value must end with a dot, use': '등록기관에서 값이 점으로 끝나야 한다고 하면 다음을 사용하세요:',
  'Preview —': '미리보기 —',
  'The wildcard rule is what makes this work end to end — it carries': '와일드카드 규칙이 전 과정을 이어줍니다. 이 규칙이 전달하는 것:',
  '{label} color': '{label} 색상',
  'Haven’t set up step 1 yet? Grove hosts your blog at': '1단계를 아직 설정하지 않으셨나요? grove가 블로그를 다음 주소에서 호스팅합니다:',
  '{n} out of 5': '5점 만점에 {n}점',
  'Run this in the repository that holds your blog': '블로그가 있는 저장소에서 실행하세요',
  'Once your first post publishes, its X / LinkedIn variants show up here.': '첫 글이 발행되면 X와 LinkedIn 버전이 여기에 표시됩니다.',
  'The search queries you rank for appear here once Search Console is connected.': 'Search Console을 연결하면 순위에 오른 검색어가 여기에 표시됩니다.',
  'this week.': '이번 주.',
  '1 draft is ready — approving keeps your publishing cadence on track.': '초안 1편이 준비됐습니다. 승인하면 발행 주기를 유지할 수 있어요.',
  '{n} drafts are ready — approving keeps your publishing cadence on track.': '초안 {n}편이 준비됐습니다. 승인하면 발행 주기를 유지할 수 있어요.',
  'Review 1 draft →': '초안 1편 검토하기 →',
  'Review {n} drafts →': '초안 {n}편 검토하기 →',
  '1 draft needs review': '초안 1편이 검토를 기다립니다',
  '{n} drafts need review': '초안 {n}편이 검토를 기다립니다',
  '{channels} cross-posting stopped': '{channels} 크로스포스팅이 중단됐습니다',
  'PNG, JPEG, WebP or GIF · up to': 'PNG, JPEG, WebP, GIF · 최대',
  'Manager score · attempt': '관리자 점수 · 시도',
  'Title & SEO': '제목과 SEO',
  'failed —': '실패 —',
  'first tweet': '첫 트윗',
  'Files read:': '읽은 파일:',
  'last read': '마지막 읽기',

  /* ── whole sentences rebuilt from fragments (word order differs in ko) ── */
  'Where the “Try {business}” banner sends readers': '“{business} 사용해 보기” 배너가 독자를 보내는 곳',
  'You have {n} posts a month, free, through {date}. No card, nothing to cancel — when it ends, everything you’ve published stays exactly where it is.':
    '{date}까지 매달 {n}편을 무료로 사용하실 수 있습니다. 카드도, 해지할 것도 없어요. 기간이 끝나도 발행한 글은 모두 그대로 남습니다.',
  'You have {n} posts a month, free. No card, nothing to cancel — when it ends, everything you’ve published stays exactly where it is.':
    '매달 {n}편을 무료로 사용하실 수 있습니다. 카드도, 해지할 것도 없어요. 기간이 끝나도 발행한 글은 모두 그대로 남습니다.',
  'of effort · 1 post': '비중 · 1편',
  'of effort · {n} posts': '비중 · {n}편',
  'Over the {range}, your content earned {clicks} clicks and {referrals} answer-engine referrals.':
    '{range} 동안 콘텐츠가 클릭 {clicks}회와 AI 검색 유입 {referrals}회를 만들었습니다.',
  'Over the {range}, your content earned {clicks} clicks.':
    '{range} 동안 콘텐츠가 클릭 {clicks}회를 만들었습니다.',

  'first-party events': '자체 수집 데이터',
  '{n} live': '{n}편 게시됨',
  'queued': '대기 중',
  'no slots': '슬롯 없음',

  /* ── auth (components/AuthForm.tsx) ──────────────────────────────────────
     One surface for sign-in and sign-up, so the copy never promises a
     "create account" step that doesn't exist. */
  'Sign in to Grove': 'Grove 로그인',
  'Enter your email to continue. New here? We’ll create your account automatically.':
    '이메일을 입력하면 바로 시작할 수 있어요. 처음이신가요? 계정은 자동으로 만들어 드립니다.',
  'Continue with Google': 'Google로 계속하기',
  'or': '또는',
  'Email': '이메일',
  'Password (8+ chars)': '비밀번호 (8자 이상)',
  'One sign-in for everything. No account yet? Just continue — we’ll set it up.':
    '로그인 하나로 모든 기능을 쓸 수 있어요. 계정이 없다면 그대로 진행하세요. 저희가 만들어 드립니다.',
  'Account created — check {email} and click the link to finish. It signs you straight in.':
    '계정을 만들었어요. {email}로 보낸 링크를 눌러 마무리해 주세요. 누르면 바로 로그인됩니다.',
  'That email already has an account, but the password is wrong. Try again, or reset it.':
    '이미 가입된 이메일인데 비밀번호가 맞지 않아요. 다시 입력하거나 비밀번호를 재설정해 주세요.',

  /* ── onboarding · about you ──────────────────────────────────────────────
     The option strings are stored ANSWERS (user_metadata), so the English is
     the value and this is only how it is displayed — see the note in
     app/onboarding/about/page.tsx. */
  'Welcome — a couple of quick things': '환영합니다 — 몇 가지만 여쭤볼게요',
  'Tell us about you': '어떤 분이신가요?',
  'This tailors your strategy and helps us understand who Grove is writing for. Takes ten seconds.':
    '전략을 맞춤화하고 Grove가 누구를 위해 글을 쓰는지 파악하는 데 쓰입니다. 10초면 끝나요.',
  'How did you find us?': 'Grove를 어떻게 알게 되셨나요?',
  'Select one…': '하나를 선택하세요…',
  'Organization name': '회사·팀 이름',
  'Acme Inc.': '아크미 주식회사',
  'What sector are you in?': '어떤 분야에서 일하시나요?',
  'How big is your team?': '팀 규모는 어떻게 되나요?',
  'Loading…': '불러오는 중…',
  'Google / search': 'Google / 검색',
  'X (Twitter)': 'X (트위터)',
  'Reddit / community': 'Reddit / 커뮤니티',
  'Friend or colleague': '지인·동료 소개',
  'Newsletter / blog': '뉴스레터 / 블로그',
  'YouTube / podcast': '유튜브 / 팟캐스트',
  'Other': '기타',
  'SaaS / Software': 'SaaS / 소프트웨어',
  'E-commerce / Retail': '이커머스 / 리테일',
  'Agency / Marketing services': '에이전시 / 마케팅 서비스',
  'Media / Content / Creator': '미디어 / 콘텐츠 / 크리에이터',
  'Finance / Fintech': '금융 / 핀테크',
  'Health / Wellness': '헬스케어 / 웰니스',
  'Education': '교육',
  'Real estate / Property': '부동산',
  'Travel / Hospitality': '여행 / 숙박',
  'Professional services': '전문 서비스',
  'Just me': '저 혼자',

  /* ── onboarding · domain ─────────────────────────────────────────────── */
  'Step 1 of 2': '2단계 중 1단계',
  'Enter your domain': '도메인을 입력하세요',
  'One field. We’ll handle the rest. Use a domain you control — the next step verifies ownership via DNS or a meta tag.':
    '한 칸만 채우면 나머지는 저희가 처리합니다. 직접 관리하는 도메인을 입력해 주세요. 다음 단계에서 DNS나 메타 태그로 소유권을 확인합니다.',
  'Failed to create domain': '도메인을 등록하지 못했어요',
  'Your existing sites keep running. {plan} adds room for this one.':
    '기존 사이트는 그대로 운영됩니다. {plan} 플랜이면 이 사이트까지 추가할 수 있어요.',
  'See {plan} →': '{plan} 살펴보기 →',

  /* ── onboarding · verify ─────────────────────────────────────────────── */
  'Step 2 of 2': '2단계 중 2단계',
  'Verify ownership of {host}': '{host} 소유권 확인',
  'Pick whichever method is easiest. You only need to do {one}. We check all three automatically.':
    '편한 방법을 고르세요. {one} 가지만 하면 됩니다. 세 가지 모두 자동으로 확인해요.',
  'one|only one of the three methods': '한',
  'DNS record': 'DNS 레코드',
  'recommended': '권장',
  'Meta tag': '메타 태그',
  'File upload': '파일 업로드',
  'Where:': '위치:',
  'Why:': '이유:',
  'Why recommended:': '권장 이유:',
  'Heads up:': '참고:',
  'Path:': '경로:',
  'Contents (exactly):': '파일 내용 (그대로):',
  'your DNS provider (Cloudflare, Namecheap, GoDaddy, Vercel domains).':
    'DNS 제공업체 (Cloudflare, Namecheap, GoDaddy, Vercel Domains).',
  'works with any website setup — even sites behind auth (Clerk, Auth0), Cloudflare Access, or proprietary CMS.':
    '어떤 사이트 구성에서도 동작합니다. 로그인 뒤에 있는 사이트(Clerk, Auth0)나 Cloudflare Access, 자체 CMS도 문제없어요.',
  'Type': '유형',
  'Name / Host': '이름 / 호스트',
  // 'Value' is already in the DNS section of the dashboard's embed page.
  '(or your apex domain)': '(또는 최상위 도메인)',
  'Auto / 3600': '자동 / 3600',
  'Propagation is usually under a minute. Up to 24h in rare cases.':
    '보통 1분 안에 반영됩니다. 드물게 최대 24시간이 걸릴 수 있어요.',
  'the {head} of your homepage HTML.': '홈페이지 HTML의 {head} 안.',
  'one line of code. Survives most auth setups because homepages are public.':
    '코드 한 줄이면 됩니다. 홈페이지는 공개돼 있으니 대부분의 로그인 설정에서도 동작해요.',
  'Verify it lives at {url} in the page source (right click → View Page Source).':
    '{url} 페이지 소스에서 확인해 보세요 (우클릭 → 페이지 소스 보기).',
  'upload a plain-text file to your site root.': '사이트 루트에 텍스트 파일을 업로드하세요.',
  'some auth middleware (Clerk, NextAuth) protects this path by default. Use DNS or meta tag if you hit issues.':
    '일부 인증 미들웨어(Clerk, NextAuth)는 이 경로를 기본으로 막습니다. 문제가 생기면 DNS나 메타 태그를 사용하세요.',
  'Checking all methods…': '모든 방법을 확인하는 중…',
  'I added it — verify now': '추가했어요 — 지금 확인',
  'Not verified yet — try again in a minute.': '아직 확인되지 않았어요. 잠시 후 다시 시도해 주세요.',
  'Don’t have DNS access right now? {skip} You can already queue topics and watch Grove write — autopilot publishing stays paused until you verify.':
    '지금 DNS에 접근할 수 없나요? {skip} 주제를 미리 등록해 두고 Grove가 글 쓰는 과정을 볼 수 있어요. 자동 발행은 확인이 끝날 때까지 멈춰 있습니다.',
  'Skip for now →': '나중에 하기 →',

  /* ── onboarding · MCP offer ──────────────────────────────────────────── */
  'Optional — for developers': '선택 사항 — 개발자용',
  'Verified. Now — is {host}’s blog in a repo?': '확인됐습니다. 혹시 {host}의 블로그가 저장소 안에 있나요?',
  'Is your blog in a repo?': '블로그가 저장소 안에 있나요?',
  'If you already have a content layer — MDX in a repo, a CMS, your own pipeline — grove can hand finished articles straight to your coding agent over MCP, into the blog you already run. No embed script, no second blog beside the first. It’s one command, and it’s easiest now, while that repo is open.':
    '이미 콘텐츠 레이어가 있다면 — 저장소의 MDX, CMS, 직접 만든 파이프라인 — grove가 완성된 글을 MCP로 코딩 에이전트에 바로 넘겨 지금 운영 중인 블로그에 넣어 줍니다. 임베드 스크립트도, 그 옆에 생기는 두 번째 블로그도 없어요. 명령어 하나면 되고, 저장소를 열어 둔 지금이 가장 쉽습니다.',
  '1 · Make a key': '1 · 키 만들기',
  'Read + write, every site on your account. Shown once, then stored only as a hash — grove can’t show it to you again.':
    '계정의 모든 사이트에 대한 읽기·쓰기 권한입니다. 한 번만 표시되고 이후에는 해시로만 저장되므로 grove도 다시 보여 줄 수 없어요.',
  'Create my key': '키 만들기',
  'Could not create the key — you can do this any time from Content API.':
    '키를 만들지 못했어요. 콘텐츠 API에서 언제든 다시 시도할 수 있습니다.',
  'Could not reach grove — you can do this any time from Content API.':
    'grove에 연결하지 못했어요. 콘텐츠 API에서 언제든 다시 시도할 수 있습니다.',
  '2 · Point your agent at grove': '2 · 에이전트를 grove에 연결하기',
  'Run it in the repository that holds your blog. Then ask it to {ask}.':
    '블로그가 있는 저장소에서 실행하세요. 그런 다음 {ask}라고 요청하면 됩니다.',
  'Run it in the repository that holds your blog — the key below is a placeholder until you make one. Then ask it to {ask}.':
    '블로그가 있는 저장소에서 실행하세요. 아래 키는 실제 키를 만들기 전까지는 예시입니다. 그런 다음 {ask}라고 요청하면 됩니다.',
  'import the new grove articles': 'grove의 새 글을 가져와 줘',
  'The agent gets the rest from grove itself — ask it for the {tool}, which covers the analytics beacon your pages need to keep and where grove should point its canonical URLs once yours are live.':
    '나머지는 에이전트가 grove에서 직접 받아 갑니다. {tool}을 요청하면 페이지에 남겨 둬야 할 분석 비콘과, 직접 만든 URL이 살아난 뒤 grove가 canonical을 어디로 가리켜야 하는지까지 안내해요.',
  'Done — open my dashboard →': '완료 — 대시보드 열기 →',
  'No repo? That’s fine — {embed} is one snippet and needs no code.':
    '저장소가 없어도 괜찮아요. {embed}는 스니펫 하나면 되고 코드가 필요 없습니다.',
  'the embed': '임베드',
  'Manage this key any time from {link} — revoke it, scope one to a single site, and see what your layer has actually taken.':
    '이 키는 {link}에서 언제든 관리할 수 있어요. 폐기하거나, 사이트 하나로 범위를 좁히거나, 콘텐츠 레이어가 실제로 가져간 내역을 확인할 수 있습니다.',
  'You can set this up any time from {link} — it’s the same key, plus per-site scoping and what your layer has actually taken.':
    '{link}에서 언제든 설정할 수 있어요. 같은 키에 사이트별 범위 설정과 콘텐츠 레이어가 실제로 가져간 내역이 더해집니다.',

  /* ── onboarding · intent (the strategist's interview) ────────────────────
     The question text and the OPTIONS both live in lib/strategy/interview.ts.
     The options are stored answers fed verbatim to the strategist, so — as in
     "about you" — English is the value and this is only the display. */
  'STEP 5 OF 6 — INTENT': '6단계 중 5단계 — 목표',
  'A few questions for {host}.': '{host}에 대해 몇 가지 여쭤볼게요.',
  'your blog': '블로그',
  'The strategist agent uses these to plan each month. All optional — skip what’s not clear yet.':
    '전략 에이전트가 매달 계획을 세울 때 참고합니다. 모두 선택 사항이니 아직 모호한 항목은 건너뛰셔도 돼요.',
  'Pick up to 2.': '최대 2개까지 선택하세요.',
  'Type a sentence or two…': '한두 문장으로 적어 주세요…',
  'Skip for now': '나중에 하기',
  'Save and continue →': '저장하고 계속 →',
  'Failed to save': '저장하지 못했어요',

  'What does the blog need to do for the business this month?':
    '이번 달 블로그가 비즈니스에 어떤 역할을 해야 하나요?',
  'drive trial signups / conversions': '체험 가입·전환 늘리기',
  'capture organic search traffic': '검색 유입 확보하기',
  'build authority with a specific audience': '특정 독자층에서 전문성 쌓기',
  'support sales / partnerships': '영업·파트너십 지원하기',
  'keep customers engaged after signup': '가입 후 고객 관계 유지하기',
  'What\'s the single number you\'d most like to move?': '가장 움직이고 싶은 지표 하나는 무엇인가요?',
  'product signups from blog': '블로그를 통한 제품 가입',
  'organic search sessions': '검색 유입 세션',
  'newsletter subscriptions': '뉴스레터 구독',
  'inbound demo requests': '데모 문의',
  'time-on-page / read-through': '체류 시간 / 완독률',
  'Who specifically do you want each article to land with? (pick up to 2)':
    '각 글이 정확히 누구에게 닿기를 바라시나요? (최대 2개)',
  'These become the lens every example, anecdote, and CTA is written for.':
    '모든 예시와 일화, CTA가 이 독자를 기준으로 쓰입니다.',
  'founders / solo product owners': '창업자 / 1인 제품 담당자',
  'product designers': '프로덕트 디자이너',
  'engineering managers / tech leads': '엔지니어링 매니저 / 테크 리드',
  'marketing / growth ops': '마케팅 / 그로스',
  'agencies & freelancers': '에이전시·프리랜서',
  'enterprise buyers': '엔터프라이즈 구매 담당자',
  'individual consumers': '개인 소비자',
  'What\'s the concrete next-step you want a conversion-intent article to push?':
    '전환을 노리는 글에서 독자가 밟았으면 하는 구체적인 다음 단계는 무엇인가요?',
  'Used verbatim by the manager agent when grading CTAs.':
    '관리자 에이전트가 CTA를 평가할 때 그대로 사용합니다.',
  'Any topics, competitors, or framings the blog should never touch?':
    '블로그가 절대 다루지 말아야 할 주제나 경쟁사, 표현이 있나요?',
  'Name competitors explicitly — they become a hard do-not-mention list for the writer + validator.':
    '경쟁사는 이름을 그대로 적어 주세요. 작성 에이전트와 검증 단계의 금지 목록이 됩니다.',
  'Paste 1–2 posts (or URLs) that already sound exactly like your brand.':
    '이미 브랜드 톤에 꼭 맞는 글 1~2편(또는 URL)을 붙여 넣어 주세요.',
  'The single biggest lever on voice. The writer is few-shot anchored on these real excerpts — not on guesses from your landing page.':
    '톤앤매너에 가장 큰 영향을 주는 항목입니다. 작성 에이전트가 랜딩 페이지에서 추측하는 대신 이 실제 예시를 기준으로 글을 씁니다.',
  'Who is the article narrator?': '글의 화자는 누구인가요?',
  'Drives the opening hook and every "I/we" in the piece.':
    '도입부와 글 전체의 1인칭 표현을 결정합니다.',
  'a named person ("I", a founder/author with a byline)': '실명 개인 (바이라인이 있는 창업자·저자, "나")',
  'the company ("we", collective voice)': '회사 (집합적인 "우리")',
  'no first person (third-person, editorial)': '1인칭 없음 (3인칭 에디토리얼)',
  'Pick the 2–3 attributes that most define how you sound.':
    '브랜드의 목소리를 가장 잘 설명하는 속성을 2~3개 골라 주세요.',
  'Each becomes a we-are / we-are-not rule the writer and brand-review grade against.':
    '각 항목이 작성과 브랜드 검토 단계에서 "이렇게 쓴다 / 이렇게 쓰지 않는다" 규칙이 됩니다.',
  'casual & conversational (not formal/institutional)': '편안한 대화체 (격식체·기관 어투가 아님)',
  'peer-level & collaborative (not authoritative/expert-down)': '동료 같은 협업 톤 (내려다보는 전문가 어투가 아님)',
  'direct & matter-of-fact (not warm/effusive)': '단도직입적이고 담백함 (따뜻하고 다정한 어투가 아님)',
  'technical & precise (not simplified/hand-wavy)': '기술적이고 정확함 (뭉뚱그리거나 단순화하지 않음)',
  'bold & energetic (not calm/measured)': '대담하고 활기참 (차분하고 절제된 어투가 아님)',
  'playful & witty (not serious/earnest)': '재치 있고 유쾌함 (진지하고 무게 있는 어투가 아님)',
  'opinionated & forward-looking (not neutral/established)': '뚜렷한 관점과 미래 지향 (중립적이거나 정석적이지 않음)',
  'Words, phrases, or clichés you\'d never say.': '절대 쓰지 않을 단어나 표현, 상투어를 적어 주세요.',
  'Merged into the banned-phrase list for this brand specifically.':
    '이 브랜드 전용 금지 표현 목록에 추가됩니다.',
};
