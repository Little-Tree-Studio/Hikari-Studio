const state = {
  page: 'script',
  view: 'cards',
  selectedBlock: 2,
  playing: false,
  previewIndex: 2,
  activeFragment: '湖畔相遇',
  blocks: [
    { type:'scene', label:'场景', title:'晨雾湖畔', subtitle:'交叉溶解 · 1.2 秒', duration:'1.2s', icon:'image' },
    { type:'sound', label:'播放音乐', title:'summer_memory.mp3', subtitle:'循环播放 · 音量 68%', duration:'0.0s', icon:'music-2' },
    { type:'narration', label:'旁白', text:'薄雾沿着湖面缓慢散开，夏日的第一束阳光落在旧码头上。', duration:'3.6s', icon:'align-left' },
    { type:'dialogue', label:'对白', speaker:'林澄', text:'你果然还是来了。', expression:'浅笑', voice:'lc_001.ogg', duration:'2.8s', icon:'message-square-text' },
    { type:'dialogue', label:'对白', speaker:'苏芮', text:'因为有人在信里说，错过今天就再也见不到这片星海了。', expression:'平静', voice:'sr_014.ogg', duration:'4.1s', icon:'message-square-text' },
    { type:'branch', label:'选项分支', title:'如何回应？', options:[['相信她','坦白心意'],['转移话题','询问往事'],['保持沉默','沉默片段']], duration:'--', icon:'git-fork' },
    { type:'narration', label:'旁白', text:'远处传来汽笛声，像是为这个迟到多年的约定写下句点。', duration:'4.0s', icon:'align-left' }
  ]
};

const chapters = [
  {name:'开始',icon:'play-circle',count:4,fragments:['片头','主菜单']},
  {name:'第一章 · 雾中的来信',icon:'book-open',count:12,active:true,fragments:['湖畔相遇','旧校舍','雨夜电话']},
  {name:'第二章 · 蓝色时刻',icon:'book-open',count:9,fragments:['天台','星象馆','未寄出的信']},
  {name:'第三章 · 回声',icon:'book-open',count:15,fragments:['秘密','分歧点','真相']},
  {name:'尾声',icon:'flag',count:5,fragments:['约定结局','星海结局']},
  {name:'公共片段',icon:'braces',count:7,fragments:['好感度判断','过场','制作人员']}
];

const escapeHtml = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const icon = name => `<i data-lucide="${name}"></i>`;
const refreshIcons = () => window.lucide?.createIcons({attrs:{'stroke-width':1.8}});

function renderTree(){
  document.querySelector('#chapterTree').innerHTML = chapters.map(ch => `<div class="chapter">
    <div class="chapter-row ${ch.active?'active':''}">${icon('chevron-down')}${icon(ch.icon)}<span>${ch.name}</span><span class="count">${ch.count}</span></div>
    <div class="fragment-list">${ch.fragments.map(f=>`<div class="fragment-row ${f===state.activeFragment?'active':''}" data-fragment="${f}">${icon('corner-down-right')}<span>${f}</span></div>`).join('')}</div>
  </div>`).join('');
}

function blockHtml(b,i){
  let body='';
  if(b.type==='dialogue') body=`<div class="dialogue-line"><div class="speaker">${b.speaker}</div><div><div class="block-text" contenteditable="true">${b.text}</div><div class="block-tags"><span class="tag">表情 · ${b.expression}</span><span class="tag">${icon('mic-2')} ${b.voice}</span></div></div></div>`;
  else if(b.type==='scene') body=`<div class="scene-summary"><img class="scene-thumb" src="assets/lake.jpg" alt="湖畔场景"><div><strong>${b.title}</strong><small>${b.subtitle}</small></div></div>`;
  else if(b.type==='sound') body=`<div class="scene-summary"><div class="scene-thumb asset-audio">${icon('audio-lines')}</div><div><strong>${b.title}</strong><small>${b.subtitle}</small></div></div>`;
  else if(b.type==='branch') body=`<div class="block-text"><strong>${b.title}</strong></div><div class="branch-options">${b.options.map(o=>`<div class="branch-option"><span>${o[0]}</span><span>${o[1]} →</span></div>`).join('')}</div>`;
  else body=`<div class="block-text" contenteditable="true">${b.text}</div>`;
  return `<div class="story-block" data-block="${i}"><button class="block-handle" title="拖动 Block">${icon('grip-vertical')}</button><div class="block-card ${b.type} ${i===state.selectedBlock?'selected':''}"><div class="block-meta">${icon(b.icon)}<span>${b.label}</span><span class="duration">${b.duration}</span></div>${body}</div></div><div class="insert-row"><button class="insert-button" data-insert="${i+1}" title="插入 Block">${icon('plus')}</button></div>`;
}

function inspectorHtml(){
  const b=state.blocks[state.selectedBlock]||state.blocks[0];
  if(b.type==='dialogue') return `<div class="field"><label>说话角色</label><select><option>${b.speaker}</option><option>苏芮</option></select></div><div class="field"><label>差分表情</label><select><option>${b.expression}</option><option>惊讶</option><option>难过</option></select></div><div class="field full"><label>对白内容</label><textarea>${b.text}</textarea></div><div class="field"><label>语音</label><input value="${b.voice}"></div><div class="field"><label>文字速度</label><input type="range" value="58"></div><div class="field full toggle-line"><span>自动聚焦说话角色</span><span class="switch"></span></div>`;
  if(b.type==='scene') return `<div class="field full"><label>场景素材</label><input value="晨雾湖畔 / lake.jpg"></div><div class="field"><label>过渡</label><select><option>交叉溶解</option><option>淡入</option><option>擦除</option></select></div><div class="field"><label>时长（秒）</label><input type="number" value="1.2" step="0.1"></div><div class="field full toggle-line"><span>预加载下一场景</span><span class="switch"></span></div>`;
  if(b.type==='branch') return `<div class="field full"><label>分支标题</label><input value="${b.title}"></div><div class="field full"><label>选项显示条件</label><input value="好感度 >= 3"></div><button class="button full">${icon('plus')} 添加选项</button>`;
  return `<div class="field full"><label>文本内容</label><textarea>${b.text||b.title}</textarea></div><div class="field"><label>文字样式</label><select><option>正文</option><option>独白</option></select></div><div class="field"><label>等待时长</label><input value="自动"></div>`;
}

function cardsView(){return `<div class="blocks-area">${state.blocks.map(blockHtml).join('')}<button class="button block" data-action="add-block">${icon('plus')} 在末尾添加 Block</button></div>`}
function plainView(){return `<div class="plain-editor">[场景]  晨雾湖畔    交叉溶解 1.2s\n[音乐]  summer_memory    循环 · 68%\n\n旁白    薄雾沿着湖面缓慢散开，夏日的第一束阳光落在旧码头上。\n\n林澄    你果然还是来了。                <浅笑>\n苏芮    因为有人在信里说，错过今天就再也见不到这片星海了。 <平静>\n\n[分支]  如何回应？ · 3 个选项\n  ├─ 相信她      → 坦白心意\n  ├─ 转移话题    → 询问往事\n  └─ 保持沉默    → 沉默片段\n\n旁白    远处传来汽笛声，像是为这个迟到多年的约定写下句点。</div>`}
function codeView(){return `<pre class="code-editor"><span class="line-no">1</span><span class="syntax-key">scene</span> lake_morning <span class="syntax-key">with</span> dissolve(1.2)\n<span class="line-no">2</span><span class="syntax-key">play music</span> <span class="syntax-string">"summer_memory.mp3"</span> loop volume 0.68\n<span class="line-no">3</span>\n<span class="line-no">4</span><span class="syntax-string">"薄雾沿着湖面缓慢散开，夏日的第一束阳光落在旧码头上。"</span>\n<span class="line-no">5</span>lin cheng <span class="syntax-string">"你果然还是来了。"</span> expression smile\n<span class="line-no">6</span>su rui <span class="syntax-string">"因为有人在信里说，错过今天就再也见不到这片星海了。"</span>\n<span class="line-no">7</span>\n<span class="line-no">8</span><span class="syntax-key">menu</span>:\n<span class="line-no">9</span>    <span class="syntax-string">"相信她"</span>: call confess\n<span class="line-no">10</span>    <span class="syntax-string">"转移话题"</span>: call memory\n<span class="line-no">11</span>    <span class="syntax-string">"保持沉默"</span>: call silence\n<span class="line-no">12</span>\n<span class="line-no">13</span><span class="syntax-comment"># 语法有效 · 已同步到 7 个 Block</span></pre>`}
function jsonView(){return `<pre class="json-editor">${escapeHtml(JSON.stringify({fragment:'lake_meeting',version:3,ops:state.blocks},null,2))}</pre>`}

function renderScript(){
  const views={cards:cardsView,plain:plainView,code:codeView,json:jsonView};
  return `<div class="editor-layout"><section class="editor-pane"><div class="tabs-row"><button class="doc-tab">${icon('home')} 开始</button><button class="doc-tab active">${icon('file-text')} 湖畔相遇 ${icon('x')}</button><button class="doc-tab">${icon('file-text')} 旧校舍 ${icon('x')}</button></div><div class="editor-toolbar"><div class="editor-title"><strong>湖畔相遇</strong><small>第一章 · 7 Blocks</small></div><button class="button ghost" data-action="import">${icon('file-up')} 导入</button><div class="view-switch">${[['cards','卡片'],['plain','纯文本'],['code',"Ren'Py"],['json','JSON']].map(v=>`<button class="view-button ${state.view===v[0]?'active':''}" data-view="${v[0]}">${v[1]}</button>`).join('')}</div></div>${views[state.view]()}</section>
  <aside class="preview-pane"><div class="preview-toolbar"><strong>实时预览</strong><select class="select-compact"><option>1280 × 720</option><option>1920 × 1080</option></select><button class="icon-button small" title="定位到光标">${icon('locate-fixed')}</button><button class="icon-button small" title="重载引擎">${icon('refresh-cw')}</button><button class="icon-button small" title="独立窗口">${icon('external-link')}</button></div><div class="stage-wrap"><div class="stage"><img class="stage-bg" src="assets/lake.jpg" alt="晨雾湖畔实时预览"><div class="stage-shade"></div><div class="character-silhouette"></div><div class="stage-ui"><div class="stage-speaker">林 澄</div><div class="stage-dialogue">你果然还是来了。</div><div class="stage-next">${icon('chevron-down')}</div></div></div></div><div class="timeline"><button data-action="play" title="播放预览">${icon(state.playing?'pause':'play')}</button><input class="range" data-action="timeline" type="range" min="0" max="6" value="${state.previewIndex}"><button title="预览设置">${icon('sliders-horizontal')}</button><div class="timecode"><span>00:08.4</span><span>00:24.7</span></div></div><section class="inspector"><div class="inspector-header"><strong>属性检查器</strong><span>${state.blocks[state.selectedBlock]?.label||'Block'}</span></div><div class="inspector-body">${inspectorHtml()}</div></section></aside></div>`;
}

const assets = [
  ['场景','晨雾湖畔','lake.jpg','2.4 MB'],['场景','远山晴空','mountain.jpg','1.1 MB'],['场景','旧校舍走廊','lake.jpg','1.8 MB'],['角色','林澄 · 校服','char','8 个差分'],['角色','苏芮 · 私服','char','6 个差分'],['BGM','summer_memory','audio','03:42'],['语音','第一章语音包','audio','126 条'],['SE','夏日环境音','audio','12 个文件']
];
function renderAssets(){return `<div class="dashboard-page"><div class="page-header"><div><h1>素材库</h1><p>统一管理角色、场景、音频、视频和界面资源</p></div><div class="page-header-actions"><button class="button ghost">${icon('folder-plus')} 新建文件夹</button><button class="button primary" data-action="import">${icon('upload')} 导入素材</button></div></div><div class="content-pad"><div class="stats-row"><div class="stat"><span>全部素材</span><strong>248</strong><small>+18 本周</small></div><div class="stat"><span>存储占用</span><strong>1.84 GB</strong><small>余量充足</small></div><div class="stat"><span>未使用</span><strong>23</strong><small>可安全清理</small></div><div class="stat"><span>缺失引用</span><strong>0</strong><small>项目健康</small></div></div><div class="filterbar"><button class="search-trigger">${icon('search')}<span>搜索素材...</span></button>${['全部','场景','角色','音频','视频','UI'].map((x,i)=>`<button class="button ${i===0?'primary':'ghost'}">${x}</button>`).join('')}</div><div class="asset-grid">${assets.map(a=>`<article class="asset-card"><div class="asset-preview">${a[2]==='char'?`<div class="asset-char"><div class="mini-person"></div></div>`:a[2]==='audio'?`<div class="asset-audio">${icon('audio-waveform')}</div>`:`<img src="assets/${a[2]}" alt="${a[1]}">`}<span class="asset-kind">${a[0]}</span></div><div class="asset-info"><strong>${a[1]}</strong><small>${a[3]}</small></div></article>`).join('')}</div></div></div>`}

function renderMap(){return `<div class="dashboard-page"><div class="page-header"><div><h1>叙事地图</h1><p>从全局检查章节、分支与结局的连接关系</p></div><div class="page-header-actions"><button class="button ghost">${icon('scan')} 适应画布</button><button class="button ghost">${icon('list-filter')} 条件筛选</button><button class="button primary">${icon('plus')} 新建剧情节点</button></div></div><div class="map-canvas"><div class="map-inner"><div class="map-edge" style="left:220px;top:151px;width:130px;transform:rotate(14deg)"></div><div class="map-edge" style="left:540px;top:191px;width:120px;transform:rotate(-36deg)"></div><div class="map-edge" style="left:540px;top:191px;width:125px;transform:rotate(27deg)"></div><div class="map-edge" style="left:540px;top:191px;width:320px;transform:rotate(5deg)"></div>${mapNode(45,110,'开始','片头 · 主菜单','play-circle','active')}${mapNode(350,150,'第一章 · 雾中的来信','12 个片段 · 3 个分支','book-open','active')}${mapNode(665,70,'坦白心意','林澄好感 +2','heart','')}${mapNode(665,245,'询问往事','解锁旧校舍线索','key-round','bad')}${mapNode(860,165,'第二章 · 蓝色时刻','9 个片段 · 条件入口','book-open','')}${mapNode(860,385,'星海结局','结局 CG · 片尾曲','sparkles','')}</div></div></div>`}
function mapNode(x,y,title,body,ico,cls){return `<article class="node ${cls}" style="left:${x}px;top:${y}px"><span class="node-port in"></span><div class="node-header">${icon(ico)}${title}</div><div class="node-body">${body}<br>双击进入剧本</div><span class="node-port out"></span></article>`}
function renderCharacters(){return `<div class="dashboard-page"><div class="page-header"><div><h1>角色管理</h1><p>设定显示名、立绘、表情、语音与说话状态</p></div><button class="button primary">${icon('user-plus')} 新建角色</button></div><div class="content-pad"><div class="asset-grid">${['林澄','苏芮','程野','旁白'].map((n,i)=>`<article class="asset-card"><div class="asset-preview"><div class="asset-char"><div class="mini-person" style="background:${['#42636a','#7c5963','#4e647c','#7a8488'][i]}"></div></div><span class="asset-kind">${i===3?'系统':'主要角色'}</span></div><div class="asset-info"><strong>${n}</strong><small>${i===3?'默认旁白样式':`${6+i*2} 个表情 · ${i+1} 套服装`}</small></div></article>`).join('')}</div></div></div>`}
function renderHistory(){return `<div class="dashboard-page"><div class="page-header"><div><h1>项目历史</h1><p>自动保存每一次重要修改，可随时比较和恢复</p></div><button class="button ghost">${icon('git-compare')} 比较版本</button></div><div class="content-pad"><div class="history-list">${[['现在','修改「湖畔相遇」对白与分支','自动保存','save'],['今天 14:32','导入第一章语音包','你 · 126 个文件','mic-2'],['今天 11:08','调整角色立绘说话状态','你 · 影响 3 个角色','user-cog'],['昨天 22:17','完成「雾中的来信」初稿','里程碑 · 4,826 字','flag'],['7 月 22 日','创建项目「星海回声」','项目初始版本','sparkles']].map(h=>`<div class="history-item"><div class="history-icon">${icon(h[3])}</div><div><strong>${h[1]}</strong><small>${h[2]}</small></div><time>${h[0]}</time></div>`).join('')}</div></div></div>`}

function renderPage(){
  const renderers={script:renderScript,assets:renderAssets,map:renderMap,characters:renderCharacters,history:renderHistory};
  document.querySelector('#pageContent').innerHTML=renderers[state.page]();
  document.querySelectorAll('.module-link').forEach(b=>b.classList.toggle('active',b.dataset.page===state.page));
  refreshIcons();
}

function showModal(content,wide=false){document.querySelector('#modalRoot').innerHTML=`<div class="modal-backdrop" data-action="close-modal"><div class="modal ${wide?'wide':''}" onclick="event.stopPropagation()">${content}</div></div>`;refreshIcons()}
function closeModal(){document.querySelector('#modalRoot').innerHTML=''}
function toast(text){const t=document.querySelector('#toast');t.querySelector('span').textContent=text;t.classList.add('show');clearTimeout(window.toastTimer);window.toastTimer=setTimeout(()=>t.classList.remove('show'),2300)}
function blockPalette(position=state.blocks.length){showModal(`<div class="modal-header"><strong>添加 Block</strong><button class="icon-button" data-action="close-modal">${icon('x')}</button></div><div class="modal-body"><div class="block-palette">${[['旁白','align-left','直接输入叙述文本','narration'],['角色对白','message-square-text','角色、表情与语音','dialogue'],['切换场景','image','场景与过渡效果','scene'],['播放音频','music-2','BGM、SE 或语音','sound'],['选项分支','git-fork','创建玩家选择','branch'],['条件判断','split','根据变量执行','if'],['摄像机','video','推拉摇移与震动','camera'],['显示角色','user-round','立绘、位置与动画','character'],['粒子特效','sparkles','天气与氛围粒子','particle'],['等待','timer','暂停剧情执行','wait'],['变量赋值','variable','修改游戏状态','setvar'],['演出动画','clapperboard','关键帧时间线','animation']].map(x=>`<button class="palette-item" data-add-type="${x[3]}" data-position="${position}">${icon(x[1])}<strong>${x[0]}</strong><small>${x[2]}</small></button>`).join('')}</div></div>` ,true)}
function publishModal(){showModal(`<div class="modal-header"><strong>发布游戏</strong><button class="icon-button" data-action="close-modal">${icon('x')}</button></div><div class="modal-body"><div class="publish-options"><div class="publish-card selected">${icon('monitor')}<strong>Windows</strong><small>64 位桌面应用</small></div><div class="publish-card">${icon('globe-2')}<strong>Web</strong><small>HTML5 浏览器版</small></div><div class="publish-card">${icon('smartphone')}<strong>Android</strong><small>APK 安装包</small></div></div><div class="check-list"><div class="check-row">${icon('check-circle-2')} 248 个素材引用完整</div><div class="check-row">${icon('check-circle-2')} 6 个章节通过语法检查</div><div class="check-row">${icon('check-circle-2')} 保存系统与游戏设置已配置</div></div></div><div class="modal-footer"><button class="button ghost" data-action="close-modal">取消</button><button class="button primary" data-action="build">${icon('package-check')} 开始构建</button></div>`)}
function searchModal(){showModal(`<div class="search-modal"><input autofocus placeholder="搜索台词、指令、素材或章节..."><div class="search-results"><div class="search-group-title">最近访问</div>${[['湖畔相遇','第一章 · Fragment','file-text'],['晨雾湖畔','场景素材 · lake.jpg','image'],['林澄','角色 · 8 个表情','user-round'],['星海结局','尾声 · Fragment','flag']].map(r=>`<div class="search-result" data-action="search-result">${icon(r[2])}<span>${r[0]}</span><small>${r[1]}</small></div>`).join('')}</div></div>`)}

document.addEventListener('click',e=>{
  const page=e.target.closest('[data-page]'); if(page){state.page=page.dataset.page;renderPage();return}
  const view=e.target.closest('[data-view]'); if(view){state.view=view.dataset.view;renderPage();return}
  const block=e.target.closest('[data-block]'); if(block){state.selectedBlock=Number(block.dataset.block);state.previewIndex=state.selectedBlock;renderPage();return}
  const insert=e.target.closest('[data-insert]'); if(insert){blockPalette(Number(insert.dataset.insert));return}
  const frag=e.target.closest('[data-fragment]'); if(frag){state.activeFragment=frag.dataset.fragment;renderTree();toast(`已打开片段：${state.activeFragment}`);refreshIcons();return}
  const add=e.target.closest('[data-add-type]'); if(add){const type=add.dataset.addType;const templates={dialogue:{type:'dialogue',label:'对白',speaker:'林澄',text:'在这里输入角色对白...',expression:'默认',voice:'未配置',duration:'--',icon:'message-square-text'},scene:{type:'scene',label:'场景',title:'选择场景素材',subtitle:'淡入 · 1.0 秒',duration:'1.0s',icon:'image'},sound:{type:'sound',label:'播放音乐',title:'选择音频素材',subtitle:'单次播放 · 100%',duration:'--',icon:'music-2'},branch:{type:'branch',label:'选项分支',title:'新的选择',options:[['选项一','目标片段'],['选项二','目标片段']],duration:'--',icon:'git-fork'}};state.blocks.splice(Number(add.dataset.position),0,templates[type]||{type:'narration',label:type==='wait'?'等待':'旁白',text:type==='wait'?'等待 1.0 秒':'在这里输入文本...',duration:'--',icon:type==='wait'?'timer':'align-left'});state.selectedBlock=Number(add.dataset.position);closeModal();renderPage();toast('已添加新的 Block');return}
  const action=e.target.closest('[data-action]')?.dataset.action;
  if(action==='add-block') blockPalette();
  if(action==='close-modal') closeModal();
  if(action==='open-search') searchModal();
  if(action==='publish') publishModal();
  if(action==='play'){state.playing=!state.playing;renderPage();if(state.playing)toast('预览正在播放')}
  if(action==='debug')toast('调试会话已启动 · 未发现错误');
  if(action==='import')toast('支持 Excel、Word、PDF、图片与纯文本导入');
  if(action==='build'){closeModal();toast('Windows 构建任务已加入队列')}
  if(action==='show-toast')toast('所有协作者的修改均已同步');
  if(action==='add-chapter')toast('已创建新章节，请输入章节名称');
  if(action==='toggle-sidebar')document.querySelector('#projectSidebar').classList.toggle('open');
  if(action==='search-result'){closeModal();state.page='script';renderPage()}
});
document.addEventListener('input',e=>{if(e.target.matches('[data-action="timeline"]'))state.previewIndex=Number(e.target.value)});
document.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();searchModal()}if(e.key==='Escape')closeModal()});

renderTree();renderPage();
