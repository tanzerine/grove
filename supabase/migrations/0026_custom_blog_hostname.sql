-- Customer-owned blog hostname (e.g. blog.oveners.com). When set AND the
-- customer points a CNAME at grove's deployment, the middleware serves the
-- whole blog — pages, canonicals, JSON-LD, sitemap, RSS, robots, llms.txt —
-- on that hostname, so search equity lands on the customer's domain with no
-- code on their site. One hostname maps to exactly one blog.
alter table domains add column if not exists custom_blog_hostname text;

create unique index if not exists domains_custom_blog_hostname_key
  on domains (custom_blog_hostname)
  where custom_blog_hostname is not null;
