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
  'Writing language': '집필 언어',
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
};
