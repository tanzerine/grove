/**
 * The first-party tracker, as a string of JavaScript.
 *
 * Emits view / dwell / scroll / outbound / exit / conversion to /api/track. No
 * external script, no cookies, no fingerprinting. Session id is per-tab
 * (sessionStorage), so refreshes count as new sessions — which keeps dwell
 * math honest.
 *
 * WHY IT LIVES IN lib/ AND NOT IN THE PAGE THAT RENDERS IT. Two surfaces need
 * the identical script now: grove's hosted article page, and a customer's own
 * article page when they render grove content in their own content layer (the
 * MCP integration kit hands them this string). The numbers this produces feed
 * `posts.reads`, which feeds the monthly strategy build — so a customer whose
 * page carries a DIFFERENT tracker, or an older copy of this one, doesn't just
 * lose a chart. Their next month's plan is written against reads that were
 * never counted. One implementation, two callers.
 *
 * The only difference between the two callers is `endpoint`: grove's own page
 * posts to a relative /api/track, and a page on the customer's domain has to
 * post to grove's absolute origin.
 */

export type BeaconOpts = {
  postId: string;
  domainId: string;
  /** The page's own hostname — an anchor leaving it counts as `outbound`. */
  hostname: string;
  /**
   * Where events go. Relative for pages grove serves; absolute
   * (https://trygroveai.com/api/track) for a page on the customer's own
   * domain, which cannot resolve a relative path to us.
   */
  endpoint?: string;
};

export function buildTrackerScript({ postId, domainId, hostname, endpoint = '/api/track' }: BeaconOpts): string {
  const host = hostname.replace(/^www\./, '');
  return `(function(){
try{
var s=sessionStorage.getItem('g_sid');
if(!s){s=Math.random().toString(36).slice(2)+Date.now().toString(36);sessionStorage.setItem('g_sid',s);}
var u=new URL(location.href);
var utm={utm_source:u.searchParams.get('utm_source')||undefined,utm_medium:u.searchParams.get('utm_medium')||undefined,utm_campaign:u.searchParams.get('utm_campaign')||undefined,query:u.searchParams.get('q')||undefined};
var post=function(extra){
  try{
    var body=JSON.stringify(Object.assign({post_id:${JSON.stringify(postId)},domain_id:${JSON.stringify(domainId)},session_id:s,referrer:document.referrer||undefined},utm,extra));
    if(navigator.sendBeacon){navigator.sendBeacon(${JSON.stringify(endpoint)},new Blob([body],{type:'application/json'}));}
    else{fetch(${JSON.stringify(endpoint)},{method:'POST',headers:{'content-type':'application/json'},body:body,keepalive:true}).catch(function(){});}
  }catch(e){}
};
post({type:'view'});
var start=Date.now(),dwell=0,active=true,sentDepths={};
document.addEventListener('visibilitychange',function(){active=document.visibilityState==='visible';start=Date.now();});
setInterval(function(){if(active){dwell+=15000;post({type:'dwell',dwell_ms:dwell});}},15000);
window.addEventListener('scroll',function(){
  var h=document.documentElement;var max=(h.scrollTop+h.clientHeight)/h.scrollHeight*100;
  [25,50,75,100].forEach(function(d){if(max>=d&&!sentDepths[d]){sentDepths[d]=1;post({type:'scroll',scroll_depth:d});}});
},{passive:true});
document.addEventListener('click',function(e){
  var t=e.target;while(t&&t.tagName!=='A')t=t.parentElement;
  if(!t||!t.href)return;
  try{var h=new URL(t.href).hostname.replace(/^www\\./,'');if(h&&h!==${JSON.stringify(host)})post({type:'outbound',outbound_url:t.href});}catch(_){}
  if(t.hasAttribute('data-conv'))post({type:'conversion',outbound_url:t.href});
},true);
window.addEventListener('pagehide',function(){post({type:'exit',dwell_ms:dwell});});
}catch(e){}})();`;
}
