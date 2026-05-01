const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { Plugin } = require('../../../js/core/plugin-base.js');
const axios = require('axios');

const TAG = '🌙 [Kimi联网搜索]';
const TAG_KFA = '🌙 [Kimi-Free-API]';
const DEFAULT_KFA_PATH = path.resolve(__dirname, 'backend', 'kimi-free-api');

function flattenPluginConfigRaw(raw) {
    const result = {};
    if (!raw || typeof raw !== 'object') return result;
    for (const [key, def] of Object.entries(raw)) {
        if (def !== null && typeof def === 'object' && 'type' in def) {
            result[key] = def.value !== undefined ? def.value : def.default;
        } else {
            result[key] = def;
        }
    }
    return result;
}

class KimiSearchPlugin extends Plugin {

    async onInit() {
        this._loadCfg();
        const tokenOk = this._c.refreshToken ? '已配置 refresh_token' : '⚠️ 未配置 refresh_token';
        this.context.log('info', `${TAG} 初始化完成 | 后端: ${this._c.baseUrl} | 模型: ${this._c.model} | ${tokenOk}`);
    }

    _readConfigFromDisk() {
        const cfgPath = path.join(__dirname, 'plugin_config.json');
        if (!fs.existsSync(cfgPath)) return {};
        try {
            let text = fs.readFileSync(cfgPath, 'utf-8');
            if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
            const raw = JSON.parse(text);
            return flattenPluginConfigRaw(raw);
        } catch {
            return {};
        }
    }

    _loadCfg() {
        let c = {};
        try {
            if (this.context && typeof this.context.getPluginConfig === 'function') {
                c = this.context.getPluginConfig() || {};
            }
        } catch {
            c = {};
        }
        if (!c || Object.keys(c).length === 0) {
            c = this._readConfigFromDisk();
        }

        const provider = (String(c.provider || 'free_api').toLowerCase() === 'official') ? 'official' : 'free_api';
        this._c = {
            provider,
            baseUrl: String(c.base_url || 'http://localhost:8000/v1').replace(/\/+$/, ''),
            refreshToken: String(c.refresh_token || '').trim(),
            model: String(c.model || 'kimi-search-silent').trim(),
            officialApiKey: String(c.official_api_key || '').trim(),
            officialBaseUrl: String(c.official_base_url || 'https://api.moonshot.cn/v1').replace(/\/+$/, ''),
            officialModel: String(c.official_model || 'kimi-k2.5').trim(),
            useSearch: c.use_search !== false,
            timeout: parseInt(c.timeout, 10) || 180000,
            maxRetries: Math.max(0, parseInt(c.max_retries, 10) || 0),
            retryDelay: Math.max(0, parseInt(c.retry_delay, 10) || 2000),
            stripCitations: c.strip_citations !== false,
            autoStartBackend: c.auto_start_backend !== false,
            backendPath: String(c.backend_path || '').trim() || DEFAULT_KFA_PATH,
            startupTimeout: parseInt(c.startup_timeout, 10) || 15000,
        };
    }

    async onStart() {
        if (this._c.provider === 'official') {
            this.context.log('info', `${TAG} provider=official，使用 Moonshot 官方 API ${this._c.officialBaseUrl}，无需托管 Kimi-Free-API 后端`);
            return;
        }
        if (!this._c.autoStartBackend) {
            this.context.log('info', `${TAG} auto_start_backend = false，跳过后端托管`);
            return;
        }
        if (await this._pingBackend()) {
            this.context.log('info', `${TAG} 后端 ${this._c.baseUrl} 已在运行（外部托管），跳过自启`);
            return;
        }
        const entry = path.join(this._c.backendPath, 'dist', 'index.js');
        if (!fs.existsSync(entry)) {
            this.context.log('warn', `${TAG} 找不到 ${entry}，跳过自启。请检查 backend_path 配置或先编译 Kimi-Free-API（npm run build）`);
            return;
        }
        this.context.log('info', `${TAG} 启动 Kimi-Free-API 子进程: ${entry}`);
        try {
            this._backendProcess = spawn(process.execPath, [entry], {
                cwd: this._c.backendPath,
                env: { ...process.env, TZ: 'Asia/Shanghai' },
                windowsHide: true,
                stdio: ['ignore', 'pipe', 'pipe'],
            });
            this._backendProcess.stdout.on('data', (chunk) => {
                const line = chunk.toString().replace(/\r?\n$/, '');
                if (line) this.context.log('info', `${TAG_KFA} ${line}`);
            });
            this._backendProcess.stderr.on('data', (chunk) => {
                const line = chunk.toString().replace(/\r?\n$/, '');
                if (line) this.context.log('warn', `${TAG_KFA} ${line}`);
            });
            this._backendProcess.on('exit', (code, signal) => {
                this.context.log('warn', `${TAG_KFA} 进程退出 code=${code} signal=${signal}`);
                this._backendProcess = null;
            });
            this._backendProcess.on('error', (err) => {
                this.context.log('warn', `${TAG_KFA} spawn 错误: ${err.message}`);
            });
            const ok = await this._waitBackendReady(this._c.startupTimeout);
            if (ok) {
                this.context.log('info', `${TAG} ✓ 后端就绪 PID=${this._backendProcess && this._backendProcess.pid}`);
            } else {
                this.context.log('warn', `${TAG} 后端启动超时(${this._c.startupTimeout}ms)，工具调用时会重试`);
            }
        } catch (e) {
            this.context.log('warn', `${TAG} 启动后端失败: ${e.message}`);
            this._backendProcess = null;
        }
    }

    async onStop() {
        await this._killBackend('onStop');
    }

    async onDestroy() {
        await this._killBackend('onDestroy');
    }

    async _pingBackend() {
        try {
            const url = this._c.baseUrl.replace(/\/v1\/?$/, '') + '/ping';
            const resp = await axios.get(url, { timeout: 2000, validateStatus: () => true });
            return resp.status === 200;
        } catch {
            return false;
        }
    }

    async _waitBackendReady(timeoutMs) {
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
            if (await this._pingBackend()) return true;
            await new Promise((r) => setTimeout(r, 500));
        }
        return false;
    }

    async _killBackend(reason) {
        const proc = this._backendProcess;
        if (!proc || proc.killed) return;
        this._backendProcess = null;
        this.context.log('info', `${TAG} [${reason}] 关闭后端进程 PID=${proc.pid}`);
        try {
            if (process.platform === 'win32') {
                await new Promise((resolve) => {
                    const tk = spawn('taskkill', ['/F', '/T', '/PID', String(proc.pid)], { windowsHide: true });
                    tk.on('exit', () => resolve());
                    tk.on('error', () => resolve());
                });
            } else {
                proc.kill('SIGTERM');
                setTimeout(() => { try { proc.kill('SIGKILL'); } catch {} }, 3000);
            }
        } catch (e) {
            this.context.log('warn', `${TAG} kill 后端失败: ${e.message}`);
        }
    }

    _stripCitations(text) {
        if (!text || typeof text !== 'string') return text;
        let s = text;
        s = s.replace(/\n+\s*(搜索结果来自|参考资料|参考来源|引用来源)[：:][\s\S]*$/i, '');
        s = s.replace(/\n+\s*(Sources?|References?|Citations?)[：:][\s\S]*$/i, '');
        s = s.replace(/^\s*【检索\s*\d+】.*(\r?\n|$)/gm, '');
        s = s.replace(/^\s*\[\d+\]\s*[A-Za-z\u4e00-\u9fff].*?https?:\/\/\S+.*(\r?\n|$)/gm, '');
        s = s.replace(/\[\^\d+\^\]/g, '');
        s = s.replace(/\[\^\d+\]/g, '');
        s = s.replace(/!?\[([^\]]*)\]\(https?:\/\/[^)]+\)/g, '$1');
        s = s.replace(/\n{3,}/g, '\n\n');
        return s.trim();
    }

    async _retry(fn, label) {
        let lastErr;
        for (let i = 0; i <= this._c.maxRetries; i++) {
            try {
                return await fn();
            } catch (e) {
                lastErr = e;
                if (i === this._c.maxRetries) break;
                this.context.log('warn', `${TAG} [${label}] 第${i + 1}次失败: ${e.message}，${this._c.retryDelay}ms 后重试...`);
                await new Promise((r) => setTimeout(r, this._c.retryDelay));
            }
        }
        throw lastErr;
    }

    _resolveModel({ deep_research, silent }) {
        if (deep_research) {
            return silent === false ? 'kimi-research' : 'kimi-research-silent';
        }
        const base = this._c.model || 'kimi-search-silent';
        if (silent === true && !/silent/i.test(base)) {
            return `${base}-silent`;
        }
        if (silent === false) {
            return base.replace(/-silent$/i, '');
        }
        return base;
    }

    async _kimiSearch({ query, deep_research = false, silent }) {
        if (!query || typeof query !== 'string' || !query.trim()) {
            return '错误：请提供查询内容(query)';
        }
        const cleanQuery = query.trim();
        try {
            const rawAnswer = this._c.provider === 'official'
                ? await this._callOfficial(cleanQuery, { deep_research })
                : await this._callFreeApi(cleanQuery, { deep_research, silent });
            if (!rawAnswer || !rawAnswer.trim()) {
                return '[Kimi 返回了空内容，可能 token 已失效或被限流]';
            }
            const answer = this._c.stripCitations ? this._stripCitations(rawAnswer) : rawAnswer;
            const stripped = rawAnswer.length - answer.length;
            this.context.log('info', `${TAG} ✓ 完成，${answer.length} 字${stripped > 0 ? `（已剥离 ${stripped} 字引用源）` : ''}`);
            return answer;
        } catch (e) {
            return this._formatError(e);
        }
    }

    async _callFreeApi(query, { deep_research, silent }) {
        if (!this._c.refreshToken) {
            throw new Error('NO_REFRESH_TOKEN');
        }
        const model = this._resolveModel({ deep_research, silent });
        this.context.log('info', `${TAG} → [free_api] 查询(model=${model}): ${query}`);

        const data = await this._retry(async () => {
            const resp = await axios.post(
                `${this._c.baseUrl}/chat/completions`,
                {
                    model,
                    messages: [{ role: 'user', content: query }],
                    use_search: this._c.useSearch,
                    stream: false,
                },
                {
                    headers: {
                        'Authorization': `Bearer ${this._c.refreshToken}`,
                        'Content-Type': 'application/json',
                    },
                    timeout: this._c.timeout,
                }
            );
            return resp.data;
        }, 'Kimi-Free-API');

        return data?.choices?.[0]?.message?.content;
    }

    async _callOfficial(query, opts = {}) {
        const { deep_research = false } = opts;
        if (!this._c.officialApiKey) {
            throw new Error('NO_OFFICIAL_API_KEY');
        }
        const model = this._c.officialModel;
        const tag = deep_research ? 'official·深度研究' : 'official';
        this.context.log('info', `${TAG} → [${tag}] 查询(model=${model}): ${query}`);

        const messages = [];
        let userContent = query;
        if (deep_research) {
            messages.push({
                role: 'system',
                content: [
                    '你是一个专业的深度研究员。对用户的问题，请遵循以下流程：',
                    '1) 必须多次调用 $web_search 工具（至少 3 次，建议 4-8 次），每次用不同的关键词从不同角度切入',
                    '2) 主动覆盖：基础事实 + 多源对比 + 反对/补充观点 + 时间线 + 关键数据/数字',
                    '3) 整合多源信息，识别并过滤错误信息、过时信息和明显偏见',
                    '4) 输出结构化的深度报告：包含【核心结论】【关键事实/数据】【时间线】【不同观点】【参考要点】',
                    '5) 报告至少 1500 字，确保深度与广度并重。',
                ].join('\n'),
            });
            userContent = `请进行深度研究：${query}`;
        }
        messages.push({ role: 'user', content: userContent });

        const tools = [{ type: 'builtin_function', function: { name: '$web_search' } }];
        const headers = {
            'Authorization': `Bearer ${this._c.officialApiKey}`,
            'Content-Type': 'application/json',
        };

        const MAX_ROUNDS = deep_research ? 15 : 5;
        const MIN_SEARCHES = deep_research ? 3 : 0;
        const MAX_NUDGES = deep_research ? 3 : 0;
        let totalSearches = 0;
        let nudgeCount = 0;
        for (let round = 1; round <= MAX_ROUNDS; round++) {
            const data = await this._retry(async () => {
                const resp = await axios.post(
                    `${this._c.officialBaseUrl}/chat/completions`,
                    { model, messages, tools, stream: false },
                    { headers, timeout: this._c.timeout }
                );
                return resp.data;
            }, `Moonshot Round ${round}`);

            const choice = data?.choices?.[0];
            if (!choice) throw new Error('Moonshot API 返回了空 choices');

            const message = choice.message || {};
            if (choice.finish_reason !== 'tool_calls') {
                if (totalSearches < MIN_SEARCHES && nudgeCount < MAX_NUDGES) {
                    messages.push(message);
                    nudgeCount++;
                    messages.push({
                        role: 'user',
                        content: `你目前只完成了 ${totalSearches} 次搜索，深度研究要求至少 ${MIN_SEARCHES} 次。请立刻调用 $web_search 工具，用与前次不同的关键词、从新的角度继续搜索（例如：换中英文、换具体子话题、换时间维度）。完成后再综合所有信息输出最终报告。`,
                    });
                    this.context.log('info', `${TAG} [${tag}] 第 ${round} 轮模型想提前 stop（搜索 ${totalSearches} 次 < 最低 ${MIN_SEARCHES}），注入引导（第 ${nudgeCount}/${MAX_NUDGES} 次）让其继续搜索`);
                    continue;
                }
                messages.push(message);
                this.context.log('info', `${TAG} [${tag}] 第 ${round} 轮拿到最终答案 (累计搜索 ${totalSearches} 次, finish_reason=${choice.finish_reason})`);
                return message.content || '';
            }
            const toolCalls = message.tool_calls || [];
            const reasoning = message.reasoning_content && String(message.reasoning_content).trim()
                ? message.reasoning_content
                : 'I should call the web search tool to find relevant information for the user.';
            const assistantMsg = {
                role: 'assistant',
                content: message.content || null,
                tool_calls: toolCalls,
                reasoning_content: reasoning,
            };
            messages.push(assistantMsg);
            totalSearches += toolCalls.length;
            this.context.log('info', `${TAG} [${tag}] 第 ${round}/${MAX_ROUNDS} 轮：模型请求 ${toolCalls.length} 个工具调用 (累计 ${totalSearches} 次)`);
            for (const tc of toolCalls) {
                messages.push({
                    role: 'tool',
                    tool_call_id: tc.id,
                    name: tc.function?.name,
                    content: tc.function?.arguments || '',
                });
            }
        }
        throw new Error(`Moonshot 工具调用循环超过 ${MAX_ROUNDS} 轮`);
    }

    _formatError(e) {
        if (e.message === 'NO_REFRESH_TOKEN') {
            return '错误：未配置 Kimi refresh_token。请前往插件设置填入 https://kimi.moonshot.cn 的 refresh_token（浏览器 Application > Local Storage）。';
        }
        if (e.message === 'NO_OFFICIAL_API_KEY') {
            return '错误：provider=official 但未配置 official_api_key。请前往 https://platform.moonshot.cn 创建账号充值后获取 sk-xxx 格式的 API Key 并填入插件设置。';
        }
        const status = e.response?.status;
        const detail = e.response?.data?.error?.message || e.response?.data?.message || e.message;
        this.context.log('warn', `${TAG} 失败 (HTTP ${status || 'N/A'}): ${detail}`);
        if (status === 401 || status === 403) {
            const target = this._c.provider === 'official' ? 'Moonshot 官方 API Key' : 'Kimi refresh_token';
            return `Kimi 认证失败 (HTTP ${status})：${target} 可能已过期或无效。详情: ${detail}`;
        }
        if (status === 429) {
            return `Kimi 限流 (HTTP 429)：${detail}`;
        }
        if (e.code === 'ECONNREFUSED' || /ECONNREFUSED|ENOTFOUND/i.test(detail)) {
            const url = this._c.provider === 'official' ? this._c.officialBaseUrl : this._c.baseUrl;
            return `无法连接到 Kimi 后端 (${url})：${detail}`;
        }
        return `Kimi 联网搜索失败：${detail}`;
    }

    getTools() {
        return [
            {
                type: 'function',
                function: {
                    name: 'kimi_web_search',
                    description: '【联网问答 - Kimi 全自动】把问题直接交给 Kimi 联网回答，Kimi 会自己完成「搜索 → 阅读网页 → 整合答案」全流程，返回的是一段已经成文的回答（含来源信息），主模型可以直接复述或在此基础上加工。\n\n适合场景：实时信息（新闻/股价/赛事/今日/最近）、需要权威来源的事实问答、复杂问题需要一站式结构化答案、不确定具体关键词的开放性问题。\n\n与 vsearch / web_search 的区别：vsearch 返回的是搜索摘要让你自己组织答案；kimi_web_search 直接返回 Kimi 写好的成稿。两者并存时：实时/简单问答优先 kimi_web_search；多源对比 / 学术 / 自定义提炼角度优先 vsearch。',
                    parameters: {
                        type: 'object',
                        properties: {
                            query: {
                                type: 'string',
                                description: '完整的自然语言问题，不是关键词。例：今天上证指数收盘是多少？／鸣潮 2.0 版本更新了什么内容？'
                            },
                            deep_research: {
                                type: 'boolean',
                                description: '深度研究模式：让 Kimi 多次（4-8 次）从不同角度联网检索、对比多源、整合 1500+ 字结构化报告。耗时 1-5 分钟，成本约普通查询的 5-10 倍。仅在用户明确要求「深度调研 / 详细分析 / 全面对比 / 写报告 / 系统了解」时启用；闲聊、实时新闻、单一事实问答用默认 false。'
                            },
                            silent: {
                                type: 'boolean',
                                description: '是否屏蔽搜索过程的中间输出。默认 true（只返回最终答案）；设为 false 会附带 Kimi 的思考与搜索步骤。'
                            }
                        },
                        required: ['query']
                    }
                }
            }
        ];
    }

    async executeTool(name, params) {
        this._loadCfg();
        if (name === 'kimi_web_search') {
            return await this._kimiSearch(params || {});
        }
        throw new Error(`${TAG} 不支持的工具: ${name}`);
    }
}

module.exports = KimiSearchPlugin;
