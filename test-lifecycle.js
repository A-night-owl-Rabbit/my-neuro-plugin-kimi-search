const fs = require('fs');
const path = require('path');
const axios = require('axios');
const KimiSearchPlugin = require('./index.js');

function loadFlatCfg() {
    let raw = fs.readFileSync(path.join(__dirname, 'plugin_config.json'), 'utf-8');
    if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);
    const cfgRaw = JSON.parse(raw);
    const cfg = {};
    for (const [k, v] of Object.entries(cfgRaw)) {
        cfg[k] = (v && typeof v === 'object' && 'type' in v) ? v.value : v;
    }
    return cfg;
}

async function pingPort(url) {
    try {
        const resp = await axios.get(url, { timeout: 2000, validateStatus: () => true });
        return resp.status;
    } catch (e) {
        return e.code || 'ERR';
    }
}

(async () => {
    const cfg = loadFlatCfg();
    const fakeContext = {
        getPluginConfig: () => cfg,
        log: (lvl, msg) => console.log(`  [${lvl}]`, msg),
    };

    const plugin = new KimiSearchPlugin();
    plugin.context = fakeContext;

    console.log('===== 生命周期测试 =====\n');

    console.log('[Step 0] 启动前 ping 8000 端口:');
    console.log('   状态:', await pingPort('http://localhost:8000/ping'));

    console.log('\n[Step 1] plugin.onInit():');
    await plugin.onInit();

    console.log('\n[Step 2] plugin.onStart()（应该自动拉起后端）:');
    const t0 = Date.now();
    await plugin.onStart();
    console.log(`   耗时: ${Date.now() - t0}ms`);

    console.log('\n[Step 3] 启动后再 ping 8000:');
    console.log('   状态:', await pingPort('http://localhost:8000/ping'));

    if (plugin._backendProcess) {
        console.log(`   子进程 PID: ${plugin._backendProcess.pid}`);
    } else {
        console.log('   ! 没有 _backendProcess（可能跳过了托管）');
    }

    console.log('\n[Step 4] 调用 kimi_web_search 工具:');
    const result = await plugin.executeTool('kimi_web_search', {
        query: '今天是几号',
    });
    console.log('   返回前 200 字:', result.substring(0, 200).replace(/\n/g, ' '));

    console.log('\n[Step 5] plugin.onStop()（应该 kill 后端）:');
    await plugin.onStop();
    await new Promise((r) => setTimeout(r, 2000));

    console.log('\n[Step 6] 关闭后再 ping 8000（应该连接拒绝）:');
    console.log('   状态:', await pingPort('http://localhost:8000/ping'));

    console.log('\n===== 测试完成 =====');
})().catch((e) => {
    console.error('FAIL:', e);
    process.exit(1);
});
