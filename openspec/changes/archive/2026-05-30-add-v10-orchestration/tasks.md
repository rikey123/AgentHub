# tasks: add-v10-orchestration

> V1.0 澶嶆潅璋冨害 + 浜у搧鍩哄骇瀹炴柦娓呭崟銆傛瘡鏉?task 寮曠敤鍏蜂綋 spec capability + requirement锛屼究浜庨獙鏀躲€?
> **鏍煎紡**锛歚- [x] N.M Task 鈥?refs: <capability>/<Requirement 鍚?`
> **閲岀▼纰?*锛歁1 鏁版嵁鍦板熀 鈫?M2 Native Runtime 鈫?M3 Settings UI 鈫?M4 Team/Squad/Task Workflow 鈫?M5 鏀跺熬楠屾敹

## 0. 鍩虹璁炬柦锛圡igration + Event Registry + CI锛?

- [x] 0.1 鍐?migration `0014_v10.sql`锛氣憼 `roles` / `runtimes` / `model_configs`锛坄api_key_ref TEXT` 鍏佽 NULL锛孫llama 鏃?key锛? `agent_bindings` 鍥涜〃锛涒憽 `rooms.leader_role_id`锛涒憿 `tasks` ADD COLUMN锛歚assignee_role_id` / `assignee_binding_id` / `delegation_chain` / `expects_review`锛坄priority` 浣跨敤鍩虹嚎鍒楋紝涓嶉噸澶?ADD锛沗assignee_agent_id` 宸插湪鍩虹嚎琛ㄤ腑锛岀‘璁や繚鐣欎綔鍏煎瀛楁锛夛紱鈶?`task_activities` 琛?鈥?refs: design/Migration Plan
- [x] 0.2 鍐?`0014_data.ts` 鏁版嵁杩佺Щ鑴氭湰锛氭妸 `agent_profiles` 鎷嗘垚 role + runtime + model_config + binding 鍥涜〃琛岋紱`room_participants.agent_binding_id` 鍥炲～锛沗tasks.assignee_role_id` 鍥炲～ 鈥?refs: agents/AgentProfile 鏁版嵁妯″瀷锛圡ODIFIED锛?
- [x] 0.3 鍦?`packages/protocol/src/events/registry.ts` 娉ㄥ唽 18 涓?V1.0 鏂颁簨浠讹紙鍚?visibility锛夆€?refs: event-system/浜嬩欢鍒嗙骇锛坉urable / ephemeral锛?
- [x] 0.4 鏂板 `ai-sdk-provider:check` CI script锛氭壂 `packages/native-agent-runtime/**` 绂佹瀛楃涓?model ID 鈥?refs: native-agent-runtime/NativeAgentAdapter 瀹炵幇
- [x] 0.5 鏇存柊 `pnpm events:check` + `pnpm visibility:check` 閫氳繃锛?8 涓柊浜嬩欢宸叉敞鍐岋級鈥?refs: event-system/events:check 涓?visibility:check CI 鏍￠獙
- [x] 0.6 HTTP middleware锛氭敹鍒版棫 `agent_profile_id` 鍏ュ弬鏃?resolve 鍒?`agent_binding_id`锛? 涓湀鍏煎灞傦級鈥?refs: agents/AgentProfile 鏁版嵁妯″瀷锛圡ODIFIED锛?

## 1. 鏁版嵁鍦板熀锛圧ole / Runtime / ModelConfig / AgentBinding锛?

- [x] 1.1 瀹炵幇 `roles` 琛?CRUD + `GET/POST/PATCH/DELETE /roles` API 鈥?refs: role-system/Role 鏁版嵁妯″瀷
- [x] 1.2 瀹炵幇鍐呯疆 Role 妯℃澘棣栧惎鍐欏叆锛? 涓ā鏉匡細project-manager / builder / reviewer / archivist / generalist锛? version 妫€娴?+ stderr 璀﹀憡 鈥?refs: role-system/鍐呯疆 Role 妯℃澘棣栧惎鍐欏叆
- [x] 1.3 瀹炵幇 `runtimes` 琛?CRUD + `GET/POST/PATCH/DELETE /runtimes` API + daemon 鍚姩鏃惰嚜鍔?detect + UPSERT 鈥?refs: runtime-settings/Runtime 鏁版嵁妯″瀷
- [x] 1.4 瀹炵幇 `POST /runtimes/:id/detect`锛堥噸鏂版娴?binary锛? `POST /runtimes/:id/test`锛堝悓姝ユ垨 job polling锛夆€?refs: runtime-settings/Runtime CRUD + Test API
- [x] 1.5 瀹炵幇 `model_configs` 琛?CRUD + `GET/POST/PATCH/DELETE /model-configs` API + API key 鍐?OS Keychain锛圞eychainBridge锛? fingerprint 鐢熸垚 鈥?refs: model-provider-settings/ModelConfig 鏁版嵁妯″瀷
- [x] 1.6 瀹炵幇 `POST /model-configs/:id/test`锛堝悓姝ユ垨 job polling锛? `GET /settings/jobs/:jobId` 鈥?refs: model-provider-settings/ModelConfig CRUD + Test API
- [x] 1.7 瀹炵幇 `agent_bindings` 琛?CRUD + `GET/POST/PATCH/DELETE /agent-bindings` API + GET 灞曞紑 role/runtime/model_config 淇℃伅 鈥?refs: agents/AgentBinding CRUD API
- [x] 1.8 鍗曞厓娴嬭瘯锛歊ole CRUD / 鏈?bindings 鏃跺垹闄よ鎷?/ 鍐呯疆妯℃澘棣栧惎 / Runtime detect / ModelConfig API key keychain / AgentBinding 涓夊眰 assignee

## 2. Native Agent Runtime

- [x] 2.1 瀹炵幇 `packages/native-agent-runtime/src/provider-registry.ts`锛氭樉寮?provider 瀹炰緥鍖栵紙createOpenAI / createAnthropic / createGoogleGenerativeAI / createOpenAICompatible锛夛紱绂佹瀛楃涓?model ID 鈥?refs: native-agent-runtime/NativeAgentAdapter 瀹炵幇
- [x] 2.2 瀹炵幇 `NativeAgentAdapter extends AgentRuntimeAdapter`锛歮anifest 澹版槑 runtimeKind="native" / crashRecovery="restartable"锛泂treamText + tool calling + cost 涓婃姤 + AbortController cancel 鈥?refs: native-agent-runtime/NativeAgentAdapter 瀹炵幇
- [x] 2.3 瀹炵幇 MCP tool 鈫?AI SDK tool 杞崲锛坱hin adapter锛屼笉鏀?MCP 鍗忚锛夆€?refs: native-agent-runtime/NativeAgentAdapter 瀹炵幇
- [x] 2.4 瀹炵幇 `model.api_call.<provider>` permission check锛坧er-Run 缂撳瓨 + deny-before-stream锛? `permission.run_summary` event 鈥?refs: native-agent-runtime/model.api_call 鏉冮檺妫€鏌? permissions/瀹℃壒绮掑害
- [x] 2.5 娉ㄥ唽 NativeAgentAdapter 鍒?AdapterRegistry锛沝aemon 鍚姩鏃惰嚜鍔ㄦ敞鍐?native-default runtime 鈥?refs: adapter-framework/Post-MVP Adapter Stub锛圡ODIFIED锛?
- [x] 2.6 闆嗘垚娴嬭瘯锛歂ativeAgentAdapter Solo Run锛堝惈 tool calling / permission ask / cancel锛夆€?refs: native-agent-runtime/NativeAgentAdapter 瀹炵幇

## 3. Settings UI + Role Generator

- [x] 3.1 瀹炵幇 Settings modal 鍏〉涓€绾ф灦鏋勶紙Roles / Runtimes / Models / Permissions / Workspace / MCP锛? FeatureRail Settings 鍏ュ彛 + Cmd+K "Open Settings" 鈥?refs: settings-ui/Settings Modal 鍏〉涓€绾ф灦鏋?
- [x] 3.2 瀹炵幇 Roles tab锛氳鑹插垪琛?+ 鏂板缓 / 缂栬緫 / 鍒犻櫎 + 鍐呯疆 Role 淇濇姢 + "AI 鐢熸垚"鍏ュ彛 鈥?refs: settings-ui/Roles tab
- [x] 3.3 瀹炵幇 Runtimes tab锛歊untime 鍗＄墖 + 妫€娴嬬姸鎬?+ InlineEditor锛坈ommand/args/env锛? test connection 鈥?refs: settings-ui/Runtimes tab
- [x] 3.4 瀹炵幇 Models tab锛歱rovider 鍒嗙粍 + API key 杈撳叆锛坢ask + fingerprint锛? baseURL + test model call 鈥?refs: settings-ui/Models tab
- [x] 3.5 瀹炵幇 Settings URL deep link锛坄?settings=<tab>`锛夆€?refs: settings-ui/Settings URL deep link
- [x] 3.6 瀹炵幇 `role_drafts` 涓存椂琛?+ GC锛? 澶?TTL + 鍚姩娓呰繃鏈?+ 姣忓皬鏃舵竻锛夆€?refs: role-generator/AI 鐢熸垚瑙掕壊鑽夌
- [x] 3.7 瀹炵幇 `POST /roles/generate 鈫?202 { jobId }` + `GET /roles/generate/jobs/:jobId` + `DELETE /roles/generate/jobs/:jobId` 鈥?refs: role-generator/AI 鐢熸垚瑙掕壊鑽夌
- [x] 3.8 瀹炵幇 Settings UI role generation 娴佺▼锛氳緭鍏ラ渶姹?鈫?polling 杩涘害 鈫?preview 鈫?淇濆瓨 / 鍙栨秷 鈥?refs: role-generator/AI 鐢熸垚瑙掕壊鑽夌
- [x] 3.9 鍗曞厓娴嬭瘯锛歋ettings REST-only锛堜笉璁㈤槄 SSE锛? role generation polling / 鑽夌 7 澶╄繃鏈?/ API key fingerprint

## 4. Squad Mode + Team Mode + Task Workflow Core

- [x] 4.1 瀹炵幇 `room.delegate` MCP tool锛堜粎 leader 鍙皟锛涘垱寤?Task + dispatch WakeAgent 鍘熷瓙鎿嶄綔锛夆€?refs: squad-mode/room.delegate MCP tool
- [x] 4.2 瀹炵幇 Squad 妯″紡璋冨害锛歀eader 娲惧彂 鈫?杞婚噺 Task锛坋xpectsReview=false锛夆啋 teammate 瀹屾垚 鈫?Task 鑷姩 completed 鈫?mailbox 缁?Leader 鈫?wake Leader 鈥?refs: squad-mode/Squad 妯″紡璋冨害
- [x] 4.3 瀹炵幇 Team 妯″紡璋冨害锛歀eader 娲惧彂 鈫?review Task锛坋xpectsReview=true锛夆啋 sibling Task 鍏ㄨ繘 review 鈫?wake Leader 鈫?Leader approve / 閲嶅仛 鈥?refs: team-mode/Team 妯″紡璋冨害
- [x] 4.4 瀹炵幇 sibling Task 瀹屾垚鍒ゅ畾锛堝弬鑰?multica `issue_child_done.go`锛夛細Orchestrator terminal hook 妫€鏌ユ墍鏈?sibling Tasks 鐘舵€?鈥?refs: team-mode/Team 妯″紡璋冨害
- [x] 4.5 瀹炵幇 Task 闃插惊鐜鍒欙細宓屽娣卞害涓婇檺 5 / 5 鍒嗛挓閲嶅 title 鎷掔粷 / 30 鍒嗛挓瓒呮椂 鈫?blocked 鈥?refs: squad-mode/Squad 妯″紡璋冨害, task-workflow-core/鏈€灏?Task 鏁版嵁妯″瀷
- [x] 4.6 瀹炵幇 `task_activities` 琛?+ `task.activity.added` 浜嬩欢 + `room.update_task` 鎵╁睍锛坅ddComment / setBlocker / linkArtifact / priority锛夆€?refs: task-workflow-core/鏈€灏?Task 鏁版嵁妯″瀷
- [x] 4.7 瀹炵幇 Task 涓夊眰 assignee锛坅ssignee_role_id + assignee_binding_id + assignee_agent_id 鍏煎锛? role鈫抌inding resolve 鈥?refs: task-workflow-core/鏈€灏?Task 鏁版嵁妯″瀷
- [x] 4.8 瀹炵幇 `rooms.leader_role_id` + squad/team room 鍒涘缓鏍￠獙锛坙eaderRoleId 蹇呭～锛夆€?refs: rooms/Room 鏁版嵁妯″瀷锛圡ODIFIED锛?
- [x] 4.9 瀹炵幇 Side Panel Tasks tab锛堝垪琛?view + status 鍒嗙粍 + Task detail slide-over + activity timeline锛夆€?refs: task-workflow-core/Task Workflow UI, web-ui/Side Panel 瑙嗗浘锛圡ODIFIED锛?
- [x] 4.10 瀹炵幇 Run Detail Tools tab 澶?Agent 鍗忎綔瑙嗗浘锛坰ibling Run 閾捐矾 + Task 鏍戯級鈥?refs: web-ui/Main Timeline 涓?Agent Run Detail 鍙岃鍥撅紙MODIFIED锛?
- [x] 4.11 瀹炵幇 TaskStatusCard锛堜富娴?brief 鍦?squad/team mode 涓嬪睍绀?dispatch 鎽樿锛夆€?refs: messaging/Card 绫诲瀷娓呭崟锛圡ODIFIED锛?
- [x] 4.12 闆嗘垚娴嬭瘯锛歋quad 3 teammate 骞惰 / Team 瀛?Task 鍏ㄨ繘 review 鍚?wake Leader / 闃插惊鐜祵濂楁繁搴?/ Task 瓒呮椂 blocked / task.updated 琚?events:check 鎷掔粷

## 5. MODIFIED Capabilities 鏀跺熬

- [x] 5.1 鏇存柊 `useProjector.ts`锛氭柊澧?`task.activity.added` / `task.delegation.created` / `task.delegation.completed` / `team.dispatch.started` / `team.dispatch.completed` handler锛坴isibility=both 浜嬩欢蹇呴』鏈?projector handler锛夆€?refs: event-system/浜嬩欢鍒嗙骇锛坉urable / ephemeral锛?
- [x] 5.2 鏇存柊 `adapter-framework`锛歂ativeAgentAdapter 娉ㄥ唽涓虹涓夌鐪熷疄 adapter锛汣odexAdapter stub 浠嶈繑鍥?501 鈥?refs: adapter-framework/Post-MVP Adapter Stub锛圡ODIFIED锛?
- [x] 5.3 鏇存柊 `v1-roadmap`锛氱Щ闄?Squad/Team 鍗犱綅 Requirement 鈥?refs: v1-roadmap/V1.0 Squad / Team 妯″紡鍗犱綅锛圧EMOVED锛?

## 6. 鏀跺熬楠屾敹

- [x] 6.1 璺?`pnpm test`锛堝叏閮ㄩ€氳繃锛? `pnpm typecheck` + `pnpm lint` 鈥?refs: design/Goals G2
- [x] 6.2 璺?`pnpm check:all`锛? 閬?CI + ai-sdk-provider:check 鍏ㄧ豢锛夆€?refs: event-system/events:check 涓?visibility:check CI 鏍￠獙
- [x] 6.3 璺?`openspec validate add-v10-orchestration --strict` 閫氳繃 鈥?refs: design/Goals G3
- [x] 6.4 璺?Playwright E2E锛堝惈 V1.0 鏂板鐢ㄤ緥锛歋ettings modal / Squad Run / Team Task review锛夆€?refs: settings-ui/Settings Modal, squad-mode/Squad 妯″紡璋冨害
- [x] 6.5 鏇存柊 tasks.md 鍕鹃€夌姸鎬侊紙鎵€鏈夊凡瀹屾垚椤?`[x]`锛夆€?refs: design/Goals G3
- [x] 6.6 鍑嗗 V1.1 plan锛歵ask-board Kanban + 鍗忎綔鍙鍖栵紙Timeline + Topology锛夆€?refs: design/Roadmap Beyond MVP V1.1 绔犺妭

## M-闃舵浜や粯寤鸿锛堜笉灞炰簬 spec锛屼粎浣滃疄鏂借鍒掑弬鑰冿級

> 杩欎簺鏄伐绋嬪疄鏂?milestone锛屼笉鏄?spec 瑕佹眰銆倀asks 0鈥? 鎻忚堪鐨勬槸"鍋氫粈涔?锛汳 闃舵鎻忚堪"鎸変粈涔堥『搴忓仛"銆?

- M1 鏁版嵁鍦板熀锛埪? + 搂1锛夛細migration / event registry / CI / Role / Runtime / ModelConfig / AgentBinding CRUD
- M2 Native Runtime锛埪?锛夛細NativeAgentAdapter + Vercel AI SDK + tool calling + permission + cancel
- M3 Settings UI锛埪?锛夛細鍏〉 Settings modal + role-generator polling
- M4 Team/Squad/Task Workflow锛埪? + 搂5锛夛細room.delegate + Squad/Team 璋冨害 + Task Workflow + projector handlers
- M5 鏀跺熬楠屾敹锛埪?锛夛細鍏ㄥ娴嬭瘯 + strict + E2E + tasks 鍕鹃€?+ V1.1 plan

> 鍏抽敭绾緥锛歁2 涔嬪墠 Native Runtime 鍙湪 Solo / Assisted 楠岃瘉锛堜笉鎺?Team/Squad锛夛紱M4 涔嬪墠 Task 璋冨害鍙敮鎸佸崟灞傦紙涓嶆敮鎸佸祵濂楋級锛涙墍鏈?Settings 鍐欒矾寰勫繀椤?emit detail events锛坅udit锛夛紝浣?Settings UI 涓嶆秷璐硅繖浜涗簨浠躲€?

