const inquirer = require('inquirer');
const YAML = require('yaml');
const fs = require('fs-extra');
const path = require('path');
const archiver = require('archiver');
const tar = require('tar');
const dotenv = require('dotenv');
const crypto = require('crypto');
const os = require('os');

const ASCII_LOGO = `
$$\\                                   $$\\   $$\\     $$\\ 
$$ |                                  $$ |  $$ |    $$ |
$$ |$$$$$$$$\\  $$$$$$$\\          $$$$$$$ |$$$$$$\\   $$ |
$$ |\\____$$  |$$  _____|$$$$$$\\ $$  __$$ |\\_$$  _|  $$ |
$$ |  $$$$ _/ $$ /      \\______|$$ /  $$ |  $$ |    $$ |
$$ | $$  _/   $$ |              $$ |  $$ |  $$ |$$\\ $$ |
$$ |$$$$$$$$\\ \\$$$$$$$\\         \\$$$$$$$ |  \\$$$$  |$$ |
\\__|\\________| \\_______|         \\_______|   \\____/ \\__|
`;

// 新增：获取目录下的文件列表
async function getFilesList(extensions) {
    const files = await fs.readdir(process.cwd());
    return files.filter(file => {
        if (!extensions) return true;
        const ext = path.extname(file).toLowerCase();
        return extensions.includes(ext);
    });
}

// 新增：读取缓存的选择
async function loadCache() {
    try {
        const cachePath = path.join(process.cwd(), '.lzc-dtl-cache.json');
        if (await fs.pathExists(cachePath)) {
            return await fs.readJson(cachePath);
        }
    } catch (error) {
        console.warn('读取缓存失败:', error.message);
    }
    return {};
}

// 修改：保存选择到缓存
async function saveCache(cache) {
    try {
        const cachePath = path.join(process.cwd(), '.lzc-dtl-cache.json');
        // 如果缓存文件已存在，先读取现有内容
        let existingCache = {};
        if (await fs.pathExists(cachePath)) {
            existingCache = await fs.readJson(cachePath);
        }
        // 合并现有缓存和新缓存
        const mergedCache = {
            ...existingCache,
            ...cache
        };
        // 特殊处理镜像缓存
        for (const [key, value] of Object.entries(cache)) {
            if (key.startsWith('image_')) {
                mergedCache[key] = {
                    ...(existingCache[key] || {}),
                    ...value
                };
            }
        }
        await fs.writeJson(cachePath, mergedCache, { spaces: 2 });
    } catch (error) {
        console.warn('保存缓存失败:', error.message);
    }
}

// 修改 updateCache 函数
async function updateCache(cache, updates) {
    // 创建深拷贝以避免直接修改原对象
    const newCache = JSON.parse(JSON.stringify(cache));
    
    // 递归合并对象，确保布尔值和镜像缓存正确处理
    for (const [key, value] of Object.entries(updates)) {
        if (key.startsWith('image_')) {
            // 特殊处理镜像缓存
            newCache[key] = {
                ...(newCache[key] || {}),  // 保留现有的镜像缓存
                ...value                    // 合并新的值
            };
        } else if (key === 'registryUrl') {
            // 保存全局注册表地址
            newCache.registryUrl = value;
        } else if (value && typeof value === 'object' && !Array.isArray(value)) {
            // 处理嵌套对象
            newCache[key] = newCache[key] || {};
            for (const [nestedKey, nestedValue] of Object.entries(value)) {
                if (typeof nestedValue === 'object' && !Array.isArray(nestedValue)) {
                    newCache[key][nestedKey] = {
                        ...(newCache[key][nestedKey] || {}),
                        ...nestedValue
                    };
                } else {
                    newCache[key][nestedKey] = nestedValue;
                }
            }
        } else if (typeof value === 'boolean') {
            // 确保布尔值被正确保存
            newCache[key] = value;
        } else {
            newCache[key] = value;
        }
    }
    
    // 使用修改后的 saveCache 函数
    await saveCache(newCache);
    return newCache;
}

async function convertApp(options = {}) {
    console.log(ASCII_LOGO);
    console.log('欢迎使用懒猫微服应用转换器');
    console.log('这个转换器可以把 docker-compose.yml 方便地转换为 懒猫微服 lpk 应用包。\n');

    let answers;
    let cache = await loadCache();
    
    // 在收集功能选项之前，先收集基本信息
    if (!options.nonInteractive) {
        const questions = [];
        
        // 基本信息设置
        if (!options.name) {
            questions.push({
                type: 'input',
                name: 'name',
                message: '请输入应用名称：',
                default: cache.name || undefined,
                validate: input => input.trim() ? true : '应用名称不能为空'
            });
        }

        if (!options.package) {
            questions.push({
                type: 'input',
                name: 'package',
                message: '请输入应用包名：',
                default: cache.package || undefined
            });
        }

        if (!options.version) {
            questions.push({
                type: 'input',
                name: 'version',
                message: '请输入应用版本：',
                default: cache.version || '0.0.1',
                validate: input => {
                    // 使用简单的语义化版本格式验证
                    const semverRegex = /^\d+\.\d+\.\d+$/;
                    if (!semverRegex.test(input)) {
                        return '请输入有效的版本号（例如：1.0.0）';
                    }
                    return true;
                }
            });
        }

        if (!options.description) {
            questions.push({
                type: 'input',
                name: 'description',
                message: '请输入应用描述：',
                default: cache.description || undefined
            });
        }

        if (!options.homepage) {
            questions.push({
                type: 'input',
                name: 'homepage',
                message: '请输入应用首页：',
                default: cache.homepage || undefined
            });
        }

        if (!options.author) {
            questions.push({
                type: 'input',
                name: 'author',
                message: '请输入作者：',
                default: cache.author || undefined
            });
        }

        // 添加功能选择
        questions.push({
            type: 'checkbox',
            name: 'app_features',
            message: '请选择应用功能：',
            choices: [
                { name: '开机自启，后台运行', value: 'background_task', checked: cache.app_features?.includes('background_task') },
                { name: '每个用户创建一个实例', value: 'multi_instance', checked: cache.app_features?.includes('multi_instance') },
                { name: '公开路由 (无需登录即可访问)', value: 'public_path', checked: cache.app_features?.includes('public_path') },
                { name: 'GPU加速', value: 'gpu_accel', checked: cache.app_features?.includes('gpu_accel') },
                { name: 'KVM加速', value: 'kvm_accel', checked: cache.app_features?.includes('kvm_accel') },
                { name: 'USB设备挂载', value: 'usb_accel', checked: cache.app_features?.includes('usb_accel') },
                { name: '文件关联 (可以打开特定类型文件)', value: 'file_handler', checked: cache.app_features?.includes('file_handler') }
            ]
        });

        if (!options.subdomain) {
            questions.push({
                type: 'input',
                name: 'subdomain',
                message: '请输入子域名：',
                default: cache.subdomain || undefined
            });
        }

        const promptAnswers = await inquirer.prompt(questions);
        answers = { ...options, ...promptAnswers };

        // 更新基本信息和功能选择到缓存
        cache = await updateCache(cache, {
            name: answers.name,
            package: answers.package,
            description: answers.description,
            homepage: answers.homepage,
            author: answers.author,
            app_features: answers.app_features,
            subdomain: answers.subdomain,
            version: answers.version
        });

        // 根据选择的功能收集详细配置
        if (answers.app_features?.length > 0) {
            // 如果选择了公开路由，收集路由配置
            if (answers.app_features.includes('public_path')) {
                let publicPaths = [];
                let addMorePaths = true;

                while (addMorePaths) {
                    const publicPathAnswer = await inquirer.prompt([
                        {
                            type: 'input',
                            name: 'path',
                            message: '请输入需要公开访问的路径：',
                            default: '/',
                            validate: input => input.trim() ? true : '路径不能为空'
                        },
                        {
                            type: 'confirm',
                            name: 'addMore',
                            message: '是否继续添加公开路径？',
                            default: false
                        }
                    ]);

                    publicPaths.push(publicPathAnswer.path);
                    addMorePaths = publicPathAnswer.addMore;
                }

                answers.public_paths = publicPaths;
                cache = await updateCache(cache, { public_paths: publicPaths });
            }

            // 如果选择了文件关联，收集文件关联配置
            if (answers.app_features.includes('file_handler')) {
                let mimeTypes = [];
                let extensions = [];
                let addMoreTypes = true;

                while (addMoreTypes) {
                    const fileHandlerAnswers = await inquirer.prompt([
                        {
                            type: 'input',
                            name: 'mime_type',
                            message: '请输入支持的MIME类型（如 audio/mpeg）：',
                            validate: input => input.trim() ? true : '请输入有效的MIME类型'
                        },
                        {
                            type: 'input',
                            name: 'extension',
                            message: '请输入对应的文件扩展名（如 .mp3）：',
                            validate: input => input.trim() ? true : '请输入有效的文件扩展名'
                        },
                        {
                            type: 'confirm',
                            name: 'addMore',
                            message: '是否继续添加文件类型？',
                            default: false
                        }
                    ]);

                    mimeTypes.push(fileHandlerAnswers.mime_type.trim());
                    extensions.push(fileHandlerAnswers.extension.trim());
                    addMoreTypes = fileHandlerAnswers.addMore;
                }

                // 收集打开文件的路由路径
                const openActionAnswer = await inquirer.prompt([{
                    type: 'input',
                    name: 'open_action',
                    message: '请输入打开文件的路由路径（使用 %u 作为文件路径占位符）：',
                    default: cache.open_action || '/open?file=%u',
                    validate: input => input.includes('%u') ? true : '路径必须包含 %u 作为文件路径占位符'
                }]);

                answers.file_handler = {
                    mime: mimeTypes,
                    extensions: extensions,
                    actions: { open: openActionAnswer.open_action }
                };

                cache = await updateCache(cache, {
                    mime_types: mimeTypes,
                    extensions: extensions,
                    open_action: openActionAnswer.open_action
                });
            }
        }

        // 在收集完基本配置后，继续处理图标文件等其他配置
        if (!options.nonInteractive) {
            // 处理图标文件
            if (!options.icon) {
                const imageFiles = await getFilesList(['.png', '.jpg', '.jpeg', '.gif']);
                if (imageFiles.length === 0) {
                    throw new Error('当前目录下没有找到图片文件');
                }

                const iconAnswer = await inquirer.prompt([{
                    type: 'list',
                    name: 'iconPath',
                    message: '请选择图标文件：',
                    choices: imageFiles,
                    pageSize: 10,
                    default: cache.iconPath || undefined
                }]);
                options.icon = iconAnswer.iconPath;
                
                // 使用辅助函数更新缓存
                cache = await updateCache(cache, { iconPath: options.icon });
            }

            // 处理 docker-compose.yml
            if (!options.compose) {
                const yamlFiles = await getFilesList(['.yml', '.yaml']);
                if (yamlFiles.length === 0) {
                    throw new Error('当前目录下没有找到 YAML 文件');
                }

                const composeAnswer = await inquirer.prompt([{
                    type: 'list',
                    name: 'composePath',
                    message: '请选择 docker-compose 文件：',
                    choices: yamlFiles,
                    pageSize: 10,
                    default: cache.composePath || undefined
                }]);
                options.compose = composeAnswer.composePath;
                
                // 使用辅助函数更新缓存
                cache = await updateCache(cache, { composePath: options.compose });
            }
        }
    } else {
        // 使用命令行参数时，确保这两个值有效
        if (options.backgroundTask === undefined || options.backgroundTask === null) {
            throw new Error('在交互模式下必须指定 --background-task 选项');
        }
        if (options.multiInstance === undefined || options.multiInstance === null) {
            throw new Error('在非交互式下必须指定 --multi-instance 选项');
        }
        
        answers = {
            name: options.name,
            package: options.package,
            description: options.description,
            homepage: options.homepage,
            author: options.author,
            background_task: options.backgroundTask,
            multi_instance: options.multiInstance,
            publicPaths: options.publicPaths,
            subdomain: options.subdomain
        };
    }

    // 验证选择的
    try {
        const composeContent = await fs.readFile(options.compose, 'utf8');
        const composeData = YAML.parse(composeContent);
        
        // 验证是否是有效的 docker-compose 文件
        if (!composeData.services) {
            throw new Error('选择的文件不是有效的 docker-compose 文件');
        }

        // 获取服务列表用于路由选择
        const services = Object.keys(composeData.services);

        // 生成 manifest.yml
        const manifest = {
            'lzc-sdk-version': '0.1',
            name: answers.name,
            package: answers.package,
            version: answers.version || '0.0.1',
            description: answers.description,
            homepage: answers.homepage,
            author: answers.author,
            application: {
                subdomain: answers.subdomain,
                background_task: answers.app_features?.includes('background_task') || false,
                multi_instance: answers.app_features?.includes('multi_instance') || false,
                gpu_accel: answers.app_features?.includes('gpu_accel') || false,
                kvm_accel: answers.app_features?.includes('kvm_accel') || false,
                usb_accel: answers.app_features?.includes('usb_accel') || false
            },
            services: {}
        };

        // 添加公开路由配置
        if (answers.public_paths) {
            manifest.application.public_path = answers.public_paths;
        }

        // 添加GPU配置
        if (answers.gpu_accel) {
            manifest.application.gpu_accel = true;
        }

        // 添加文件关联配置
        if (answers.file_handler) {
            manifest.application.file_handler = answers.file_handler;
        }

        // 处理路由规则
        let routes = [];
        if (!options.routes) {
            const routeTypes = [
                { name: 'HTTP路由', value: 'http' },
                { name: 'HTTPS路由', value: 'https' },
                { name: 'TCP/UDP端口暴露', value: 'port' },
                { name: '从docker-compose读取端口', value: 'from_compose' }
            ];

            // 询问是否需要添更多路由
            let addMore = true;
            while (addMore) {
                // 路由类型
                const routeTypeAnswer = await inquirer.prompt([{
                    type: 'list',
                    name: 'type',
                    message: '请选择路由类型：',
                    choices: routeTypes,
                    default: cache.lastRouteType || undefined
                }]);

                // 使用辅助函数更新缓存
                cache = await updateCache(cache, { lastRouteType: routeTypeAnswer.type });

                if (routeTypeAnswer.type === 'from_compose') {
                    // 从 docker-compose 读端口
                    for (const [serviceName, service] of Object.entries(composeData.services)) {
                        if (service.ports) {
                            for (const portMapping of service.ports) {
                                // 处理不同格式的端口映射
                                let hostPort, containerPort;
                                
                                if (typeof portMapping === 'string') {
                                    if (portMapping.includes(':')) {
                                        // 处理 1080:80 格式
                                        [hostPort, containerPort] = portMapping.split(':');
                                    } else {
                                        // 处理 80 格式
                                        containerPort = portMapping;
                                        hostPort = portMapping;
                                    }
                                } else if (typeof portMapping === 'number') {
                                    // 处理纯数字格式
                                    containerPort = portMapping.toString();
                                    hostPort = containerPort;
                                }
                                
                                // 移除可能的协议前缀（如 "80/tcp"）
                                containerPort = containerPort.split('/')[0];
                                hostPort = hostPort.split('/')[0];
                                
                                // 生成一个更有结构的缓存键
                                const cacheKey = `port_mappings`;
                                const mappingKey = `${serviceName}_${hostPort}_${containerPort}`;
                                
                                // 确保布尔值默认值正确处理
                                const usePortAnswer = await inquirer.prompt([{
                                    type: 'confirm',
                                    name: 'use',
                                    message: `是否添加服务 ${serviceName} 的端口映射 ${hostPort}:${containerPort}？`,
                                    default: cache[cacheKey]?.[mappingKey]?.use === undefined ? true : cache[cacheKey]?.[mappingKey]?.use
                                }]);

                                if (usePortAnswer.use) {
                                    // 询问路由类型
                                    const routeTypeForPort = await inquirer.prompt([{
                                        type: 'list',
                                        name: 'type',
                                        message: `请选择 ${serviceName}:${containerPort} 的路由类型：`,
                                        choices: [
                                            { name: 'HTTP路由', value: 'http' },
                                            { name: 'HTTPS路由', value: 'https' },
                                            { name: 'TCP/UDP端口暴露', value: 'port' }
                                        ],
                                        default: cache[cacheKey]?.[mappingKey]?.type || 'http'
                                    }]);

                                    if (routeTypeForPort.type === 'port') {
                                        // 询问协议类型
                                        const protocolAnswer = await inquirer.prompt([{
                                            type: 'list',
                                            name: 'protocol',
                                            message: '请选择协议：',
                                            choices: ['tcp', 'udp'],
                                            default: cache[cacheKey]?.[mappingKey]?.protocol || 'tcp'
                                        }]);

                                        // 使用更新后的缓存结构
                                        cache = await updateCache(cache, {
                                            [cacheKey]: {
                                                [mappingKey]: {
                                                    use: usePortAnswer.use === true,
                                                    type: routeTypeForPort.type,
                                                    protocol: protocolAnswer.protocol
                                                }
                                            }
                                        });

                                        routes.push({
                                            type: 'ingress',
                                            config: {
                                                protocol: protocolAnswer.protocol,
                                                port: parseInt(containerPort),
                                                service: serviceName
                                            }
                                        });
                                    } else {
                                        // HTTP/HTTPS路由
                                        const pathAnswer = await inquirer.prompt([{
                                            type: 'input',
                                            name: 'path',
                                            message: '请输入路由路径（如 /api/）：',
                                            default: cache[cacheKey]?.[mappingKey]?.path || '/'
                                        }]);

                                        // 询问目标路径
                                        const targetPathAnswer = await inquirer.prompt([{
                                            type: 'input',
                                            name: 'targetPath',
                                            message: '请输入目标路径（如 / 或 /api/）：',
                                            default: cache[cacheKey]?.[mappingKey]?.targetPath || '/'
                                        }]);

                                        // 使用更新后的缓存结构
                                        cache = await updateCache(cache, {
                                            [cacheKey]: {
                                                [mappingKey]: {
                                                    use: usePortAnswer.use === true,
                                                    type: routeTypeForPort.type,
                                                    path: pathAnswer.path,
                                                    targetPath: targetPathAnswer.targetPath
                                                }
                                            }
                                        });

                                        // 构建 URL，确保路径正确拼接
                                        const targetPath = targetPathAnswer.targetPath.startsWith('/') ? targetPathAnswer.targetPath : '/' + targetPathAnswer.targetPath;
                                        const target = `${routeTypeForPort.type}://${serviceName}.${answers.package}.lzcapp:${containerPort}${targetPath}`;

                                        routes.push({
                                            type: 'http',
                                            config: {
                                                path: pathAnswer.path,
                                                target: target
                                            }
                                        });
                                    }
                                } else {
                                    // 保存不使用的选择
                                    cache = await updateCache(cache, {
                                        [cacheKey]: {
                                            [mappingKey]: {
                                                use: false
                                            }
                                        }
                                    });
                                }
                            }
                        }
                    }
                } else if (routeTypeAnswer.type === 'port') {
                    const portConfig = await inquirer.prompt([
                        {
                            type: 'list',
                            name: 'protocol',
                            message: '请选择协议：',
                            choices: ['tcp', 'udp'],
                            default: cache.lastPortProtocol || undefined
                        },
                        {
                            type: 'input',
                            name: 'port',
                            message: '请输入端口号：',
                            default: cache.lastPort || undefined,
                            validate: (input) => {
                                const port = parseInt(input);
                                if (isNaN(port) || port < 1 || port > 65535) {
                                    return '请输入有效的端号（1-65535）';
                                }
                                return true;
                            }
                        },
                        {
                            type: 'list',
                            name: 'service',
                            message: '请选择服务：',
                            choices: services,
                            default: cache.lastService || undefined
                        }
                    ]);

                    // 使用辅助函数更新缓存
                    cache = await updateCache(cache, {
                        lastPortProtocol: portConfig.protocol,
                        lastPort: portConfig.port,
                        lastService: portConfig.service
                    });

                    // 添加 TCP/UDP 端口路由
                    routes.push({
                        type: 'ingress',
                        config: {
                            protocol: portConfig.protocol,
                            port: parseInt(portConfig.port),
                            service: portConfig.service
                        }
                    });

                } else if (routeTypeAnswer.type === 'http' || routeTypeAnswer.type === 'https') {
                    const httpConfig = await inquirer.prompt([
                        {
                            type: 'input',
                            name: 'path',
                            message: '请输入路由路径（如 /api/）：',
                            default: cache.lastHttpPath || '/'
                        },
                        {
                            type: 'list',
                            name: 'service',
                            message: '请选择服务：',
                            choices: services,
                            default: cache.lastHttpService || undefined
                        },
                        {
                            type: 'input',
                            name: 'port',
                            message: '请输入服务端口：',
                            default: cache.lastHttpPort || undefined,
                            validate: (input) => {
                                const port = parseInt(input);
                                if (isNaN(port) || port < 1 || port > 65535) {
                                    return '请输入有效的端口号（1-65535）';
                                }
                                return true;
                            }
                        },
                        {
                            type: 'input',
                            name: 'targetPath',
                            message: '请输入目标路径（如 / 或 /api/）：',
                            default: cache.lastHttpTargetPath || '/'
                        }
                    ]);

                    // 使用辅助函数更新缓存
                    cache = await updateCache(cache, {
                        lastHttpPath: httpConfig.path,
                        lastHttpService: httpConfig.service,
                        lastHttpPort: httpConfig.port,
                        lastHttpTargetPath: httpConfig.targetPath
                    });

                    // 构建目标 URL，确保路径正确拼接
                    const targetPath = httpConfig.targetPath.startsWith('/') ? httpConfig.targetPath : '/' + httpConfig.targetPath;
                    const target = `${routeTypeAnswer.type}://${httpConfig.service}.${answers.package}.lzcapp:${httpConfig.port}${targetPath}`;

                    // 添加 HTTP/HTTPS 路由
                    routes.push({
                        type: 'http',
                        config: {
                            path: httpConfig.path,
                            target: target
                        }
                    });
                }

                // 询问是否继续添加路由
                const continueAnswer = await inquirer.prompt([{
                    type: 'confirm',
                    name: 'addMore',
                    message: '是否继续添加路由？',
                    default: false
                }]);

                addMore = continueAnswer.addMore;
            }
        } else {
            // 处理命令行参数中的路由配置
            routes = options.routes;
        }

        // 添加路由配置
        const httpRoutes = routes
            .filter(r => r.type === 'http')
            .map(r => `${r.config.path}=${r.config.target}`);
        
        if (httpRoutes.length > 0) {
            manifest.application.routes = httpRoutes;
        }

        // 添加端口露配置
        const ingressRoutes = routes.filter(r => r.type === 'ingress');
        if (ingressRoutes.length > 0) {
            manifest.application.ingress = ingressRoutes.map(r => ({
                protocol: r.config.protocol,
                port: r.config.port,
                service: r.config.service
            }));
        }

        // 在处理 services 的部之前，直接在当前目录创建 content.tar
        const executionDir = process.cwd(); // 获取 lzc-dtl 执行的目录

        // 创建 content.tar，包含当前目录下的有文件和目录
        await tar.create(
            {
                file: 'content.tar',
                cwd: executionDir,
                portable: true,
                // 排除一些不需要的文件和目录
                filter: (path) => {
                    const excludes = ['node_modules', '.git', '*.lpk', 'content.tar'];
                    return !excludes.some(exclude => path.includes(exclude));
                }
            },
            await fs.readdir(executionDir)
        );

        // Load environment variables from .env file
        const envPath = path.join(process.cwd(), '.env');
        const envConfig = dotenv.config({ path: envPath }).parsed || {};

        // 添加一个处理环境变量替换的辅助数
        function processEnvVariables(value, envConfig) {
            if (typeof value !== 'string') return value;
            
            let processedValue = value;
            const envMatches = value.match(/\${[^}]+}/g);
            
            if (envMatches) {
                for (const match of envMatches) {
                    const envExpression = match.slice(2, -1);
                    let envName, defaultValue;
                    
                    if (envExpression.includes(':-')) {
                        [envName, defaultValue] = envExpression.split(':-');
                    } else {
                        envName = envExpression;
                    }
                    
                    // 获取环境变量值或使用默认值
                    const envValue = envConfig[envName] || process.env[envName] || defaultValue || '';
                    processedValue = processedValue.replace(match, envValue);
                }
            }
            
            return processedValue;
        }

        // Load global config
        const globalConfig = await loadGlobalConfig();

        // 添加处理构建的函数
        async function processBuild(serviceName, packageName, cache, globalConfig, service) {
            // Generate cache key for this build
            const buildKey = `build_${serviceName}`;
            
            // 如果构建缓存存在且有 imageName，询问是否使用缓存
            if (cache[buildKey]?.imageName) {
                const useCacheAnswer = await inquirer.prompt([{
                    type: 'confirm',
                    name: 'useCache',
                    message: `[${serviceName}] 发现已缓存的构建配置，是否使用？`,
                    default: true
                }]);

                if (useCacheAnswer.useCache) {
                    console.log(`[${serviceName}] 使用缓存的构建配置: ${cache[buildKey].imageName}`);
                    return cache[buildKey].imageName;
                }
            }
            
            // Ask if user wants to build
            const buildAnswer = await inquirer.prompt([{
                type: 'confirm',
                name: 'build',
                message: `[${serviceName}] 是否需要构建镜像？`,
                default: cache[buildKey]?.build === undefined ? true : cache[buildKey]?.build
            }]);
            
            // 更新缓存
            let buildCache = {
                ...(cache[buildKey] || {}),
                build: buildAnswer.build
            };
            
            cache = await updateCache(cache, {
                [buildKey]: buildCache
            });
            
            if (!buildAnswer.build) {
                throw new Error(`服务 ${serviceName} 既没有 image 也不构建，无法继续`);
            }
            
            // 检查注册表地址
            let registryUrl = cache.registryUrl;
            if (!registryUrl && globalConfig.registryUrl) {
                registryUrl = globalConfig.registryUrl;
            }
            
            // 如果没有注表地址，询问
            if (!registryUrl) {
                const registryAnswer = await inquirer.prompt([{
                    type: 'input',
                    name: 'url',
                    message: '请输入远程仓库地址：',
                    validate: input => input.trim() ? true : '仓库地址不能为空'
                }]);
                
                registryUrl = registryAnswer.url;
                
                // Ask if want to save globally
                const saveGloballyAnswer = await inquirer.prompt([{
                    type: 'confirm',
                    name: 'save',
                    message: '是否要全局保存该仓库地址？',
                    default: true
                }]);
                
                if (saveGloballyAnswer.save) {
                    await saveGlobalConfig({ ...globalConfig, registryUrl });
                }
                
                // 更新缓存
                cache = await updateCache(cache, { registryUrl });
            }
            
            // Generate image name
            const packageBaseName = packageName.split('.').pop();
            const buildHash = crypto.createHash('md5').update(`${serviceName}_${new Date().toISOString()}`).digest('hex');
            const imageName = `${registryUrl}/${packageBaseName}:${buildHash}`;
            
            // 更新构建缓存
            buildCache = {
                ...buildCache,
                imageName,
                timestamp: new Date().toISOString()
            };
            
            cache = await updateCache(cache, {
                [buildKey]: buildCache
            });
            
            // Get build configuration from the passed service parameter
            const buildConfig = service.build;
            let buildContext = '.';
            let dockerfilePath = null;

            // Handle build config variations
            if (typeof buildConfig === 'string') {
                buildContext = buildConfig;
            } else if (typeof buildConfig === 'object') {
                buildContext = buildConfig.context || '.';
                dockerfilePath = buildConfig.dockerfile;
            }

            // Resolve build context path relative to docker-compose file location
            buildContext = path.resolve(executionDir, buildContext);

            // Construct build command
            let buildCmd = `docker build -t ${imageName}`;
            if (dockerfilePath) {
                // Resolve dockerfile path relative to build context
                const fullDockerfilePath = path.resolve(buildContext, dockerfilePath);
                buildCmd += ` -f ${fullDockerfilePath}`;
            }
            buildCmd += ` ${buildContext}`;

            console.log(`[${serviceName}] 正在构建镜像: ${imageName}`);
            console.log(`[${serviceName}] 构建上下文: ${buildContext}`);
            if (dockerfilePath) {
                console.log(`[${serviceName}] Dockerfile: ${dockerfilePath}`);
            }
            
            await execCommand(buildCmd);

            console.log(`[${serviceName}] 正在推送镜像到远程仓库: ${imageName}`);
            await execCommand(`docker push ${imageName}`);

            return imageName;
        }

        // 修改服务处理部分
        for (const [name, service] of Object.entries(composeData.services)) {
            // 处理服务名称中的环境变量
            const processedName = processEnvVariables(name, envConfig);
            
            let serviceImage;
            
            // 处理镜像或构建
            if (service.image) {
                const processedImage = processEnvVariables(service.image, envConfig);
                serviceImage = await processImage(processedImage, answers.package, cache, globalConfig, processedName);
            } else if (service.build) {
                // Pass the service object to processBuild
                serviceImage = await processBuild(processedName, answers.package, cache, globalConfig, service);
            } else {
                throw new Error(`服务 ${processedName} 既没有 image 也没有 build 配置`);
            }

            manifest.services[processedName] = {
                image: serviceImage
            };

            // 处理环境变量
            if (service.env_file) {
                const envFilePath = path.resolve(executionDir, processEnvVariables(service.env_file, envConfig));
                const fileEnvConfig = dotenv.config({ path: envFilePath }).parsed || {};
                manifest.services[processedName].environment = Object.entries(fileEnvConfig).map(
                    ([key, value]) => `${processEnvVariables(key, envConfig)}=${processEnvVariables(value, envConfig)}`
                );
            } else if (service.environment) {
                if (Array.isArray(service.environment)) {
                    manifest.services[processedName].environment = service.environment.map(env => {
                        if (typeof env === 'string') {
                            const [key, value] = env.split('=');
                            return `${processEnvVariables(key, envConfig)}=${processEnvVariables(value, envConfig)}`;
                        }
                        return env;
                    });
                } else {
                    manifest.services[processedName].environment = [];
                    for (const [key, value] of Object.entries(service.environment)) {
                        const processedKey = processEnvVariables(key, envConfig);
                        const processedValue = processEnvVariables(value, envConfig);
                        manifest.services[processedName].environment.push(`${processedKey}=${processedValue}`);
                    }
                }
            }

            // 处理命令中的环境变量
            if (service.command) {
                let processedCommand;
                if (Array.isArray(service.command)) {
                    // 如果是数组，先处理每个元素的环境变量，然后用空格连接
                    processedCommand = service.command
                        .map(cmd => processEnvVariables(cmd, envConfig))
                        .join(' ');
                } else {
                    // 如果是字符串，直接处理环境变量
                    processedCommand = processEnvVariables(service.command, envConfig);
                }
                manifest.services[processedName].command = processedCommand;
            }

            // 处理 entrypoint 中的环境变量
            if (service.entrypoint) {
                let processedEntrypoint;
                if (Array.isArray(service.entrypoint)) {
                    // 如果是数组，先处理每个元素的环境变量，然后用空格连接
                    processedEntrypoint = service.entrypoint
                        .map(entry => processEnvVariables(entry, envConfig))
                        .join(' ');
                } else {
                    // 如果是字符串，直接处理环境变量
                    processedEntrypoint = processEnvVariables(service.entrypoint, envConfig);
                }
                manifest.services[processedName].entrypoint = processedEntrypoint;
            }

            // 处理依赖关系中的环境变量
            if (service.depends_on) {
                if (Array.isArray(service.depends_on)) {
                    manifest.services[processedName].depends_on = service.depends_on.map(dep => 
                        processEnvVariables(dep, envConfig)
                    );
                } else {
                    manifest.services[processedName].depends_on = Object.fromEntries(
                        Object.entries(service.depends_on).map(([key, value]) => [
                            processEnvVariables(key, envConfig),
                            value
                        ])
                    );
                }
            }

            // 处理卷挂载中的环境变量
            if (service.volumes) {
                manifest.services[processedName].binds = [];
                
                for (const volume of service.volumes) {
                    // 移除注释部分并处理环境变量
                    const volumeConfig = typeof volume === 'string' ? 
                        processEnvVariables(volume.split('#')[0].trim(), envConfig) : 
                        volume;
                    
                    if (!volumeConfig) continue;

                    let targetPath;
                    let sourcePath;

                    // 提取目标路径，不管是对象格式还是字符串格式
                    if (typeof volumeConfig === 'object') {
                        targetPath = processEnvVariables(volumeConfig.target, envConfig);
                        if (volumeConfig.source) {
                            sourcePath = processEnvVariables(volumeConfig.source, envConfig);
                        }
                    } else {
                        // 分割源路径和目标路径
                        const volumeParts = volumeConfig.split(':');
                        if (volumeParts.length === 1) {
                            // 处理匿名卷
                            targetPath = volumeParts[0].trim();
                            
                            // 询问用户如何处理匿名卷
                            const volumeActionAnswer = await inquirer.prompt([{
                                type: 'list',
                                name: 'action',
                                message: `如何处理匿名卷 ${targetPath}？`,
                                choices: [
                                    { name: '挂载空目录', value: 'emptyDir' },
                                    { name: '忽略挂载', value: 'ignore' }
                                ],
                                default: cache[`${processedName}_volume_${targetPath}_action`] || 'emptyDir'
                            }]);

                            // 更新缓存
                            cache = await updateCache(cache, {
                                [`${processedName}_volume_${targetPath}_action`]: volumeActionAnswer.action
                            });

                            if (volumeActionAnswer.action === 'emptyDir') {
                                const { bindMount, cache: newCache } = await promptMountLocation(processedName, targetPath, cache);
                                manifest.services[processedName].binds.push(bindMount);
                                cache = newCache;  // 更新缓存
                            }
                            continue;
                        }

                        sourcePath = volumeParts[0];
                        targetPath = volumeParts[1];

                        // 检查是否是命名卷
                        const isNamedVolume = sourcePath && !sourcePath.startsWith('./') && !sourcePath.startsWith('../') && 
                            !sourcePath.startsWith('/') && !sourcePath.startsWith('~') && !path.isAbsolute(sourcePath);

                        if (isNamedVolume) {
                            // 询问用户如何处理命名卷
                            const volumeActionAnswer = await inquirer.prompt([{
                                type: 'list',
                                name: 'action',
                                message: `如何处理命名卷 ${sourcePath}:${targetPath}？`,
                                choices: [
                                    { name: '挂载空目录', value: 'emptyDir' },
                                    { name: '忽略挂载', value: 'ignore' }
                                ],
                                default: cache[`${processedName}_volume_${sourcePath}_${targetPath}_action`] || 'emptyDir'
                            }]);

                            // 更新缓存
                            cache = await updateCache(cache, {
                                [`${processedName}_volume_${sourcePath}_${targetPath}_action`]: volumeActionAnswer.action
                            });

                            if (volumeActionAnswer.action === 'emptyDir') {
                                const { bindMount, cache: newCache } = await promptMountLocation(processedName, targetPath, cache);
                                manifest.services[processedName].binds.push(bindMount);
                                cache = newCache;  // 更新缓存
                            }
                            continue;
                        }

                        // 处理源路径中的波浪号
                        if (sourcePath && sourcePath.startsWith('~')) {
                            sourcePath = sourcePath.replace('~', process.env.HOME || process.env.USERPROFILE);
                        }

                        // 检查目录是否存在
                        let choices = [
                            { name: '挂载空目录', value: 'emptyDir' },
                            { name: '忽略挂载', value: 'ignore' }
                        ];

                        let absoluteSourcePath;
                        if (sourcePath) {
                            absoluteSourcePath = path.resolve(executionDir, sourcePath);
                            const exists = await fs.pathExists(absoluteSourcePath);
                            if (exists) {
                                choices.unshift({ name: '使用目录内容', value: 'useContent' });
                            }
                        }

                        // 询问用户如何处理挂载
                        const volumeActionAnswer = await inquirer.prompt([{
                            type: 'list',
                            name: 'action',
                            message: `如何处理挂载点 ${targetPath}？`,
                            choices: choices,
                            default: cache[`${processedName}_volume_${targetPath}_action`] || (sourcePath ? 'useContent' : 'emptyDir')
                        }]);

                        // 更新缓存
                        cache = await updateCache(cache, {
                            [`${processedName}_volume_${targetPath}_action`]: volumeActionAnswer.action
                        });

                        if (volumeActionAnswer.action === 'useContent' && sourcePath) {
                            // 对于相对路径或绝对路径，使用 /lzcapp/pkg/content 中的内容
                            const relativePath = path.relative(executionDir, absoluteSourcePath);
                            // 使用 posix 风格的路径
                            const posixPath = relativePath.split(path.sep).join(path.posix.sep);
                            manifest.services[processedName].binds.push(`/lzcapp/pkg/content/${posixPath}:${targetPath}`);
                        } else if (volumeActionAnswer.action === 'emptyDir') {
                            const { bindMount, cache: newCache } = await promptMountLocation(processedName, targetPath, cache);
                            manifest.services[processedName].binds.push(bindMount);
                            cache = newCache;  // 更新缓存
                        }
                    }
                }
            }
        }

        // 写入 manifest.yml
        await fs.writeFile('manifest.yml', YAML.stringify(manifest));

        // 复制图标文件，如果源文件和目标文件不同才复制
        const iconDestPath = path.join(process.cwd(), 'icon.png');
        if (path.resolve(options.icon) !== path.resolve(iconDestPath)) {
            await fs.copy(options.icon, iconDestPath);
        }

        // 创建 lpk 文件
        const output = fs.createWriteStream(`${answers.package}.lpk`);
        const archive = archiver('zip');

        archive.pipe(output);
        archive.file('manifest.yml', { name: 'manifest.yml' });
        archive.file('icon.png', { name: 'icon.png' });

        // 将 content.tar 添加到压缩包
        archive.file('content.tar', { name: 'content.tar' });

        await archive.finalize();

        // 清理临时文件
        await fs.remove('content.tar');

        console.log(`\n转换完成！已生成应用包：${answers.package}.lpk`);
    } catch (error) {
        // 确保清理临时文件
        try {
            await fs.remove('content.tar');
        } catch (cleanupError) {
            console.error('清理临时文件失败:', cleanupError);
        }
        throw new Error(`处理文件时出错：${error.message}`);
    }
}

// 将询问挂载位置的逻辑抽取成一个函数
async function promptMountLocation(name, targetPath, cache) {
    // 询问用户选择挂载位置
    const mountLocationAnswer = await inquirer.prompt([{
        type: 'list',
        name: 'location',
        message: `请选择 ${targetPath} 的挂载位置：`,
        choices: [
            { name: '应用内部数据目录 (/lzcapp/var)', value: 'app_data' },
            { name: '用户文稿数据目录 (/lzcapp/run/mnt/home)', value: 'user_data' }
        ],
        default: cache[`${name}_volume_${targetPath}_location`] || 'app_data'
    }]);

    // 更新缓存并获取新的缓存对象
    cache = await updateCache(cache, {
        [`${name}_volume_${targetPath}_location`]: mountLocationAnswer.location
    });

    if (mountLocationAnswer.location === 'app_data') {
        // 挂载到应用内部数据目录
        return {
            bindMount: `/lzcapp/var/${path.basename(targetPath)}:${targetPath}`,
            cache
        };
    } else {
        // 询问用户文稿数据目录的子目录名称
        const subDirAnswer = await inquirer.prompt([{
            type: 'input',
            name: 'subdir',
            message: '请输入用户文稿数据目录下的子目录名称：',
            default: cache[`${name}_volume_${targetPath}_subdir`] || path.basename(targetPath),
            validate: input => {
                if (!input.trim()) return '子目录名称不能为空';
                if (input.includes('/')) return '子目录名称不能包含斜杠';
                return true;
            }
        }]);

        // 更新缓存并获取新的缓存对象
        cache = await updateCache(cache, {
            [`${name}_volume_${targetPath}_subdir`]: subDirAnswer.subdir
        });

        // 挂载到用户文稿数据目录
        return {
            bindMount: `/lzcapp/run/mnt/home/${subDirAnswer.subdir}:${targetPath}`,
            cache
        };
    }
}

// Add this function to handle global config
async function loadGlobalConfig() {
    try {
        const configPath = path.join(os.homedir(), '.lzc-dtl.json');
        if (await fs.pathExists(configPath)) {
            return await fs.readJson(configPath);
        }
    } catch (error) {
        console.warn('读取全局配置失败:', error.message);
    }
    return {};
}

// Add this function to save global config
async function saveGlobalConfig(config) {
    try {
        const configPath = path.join(os.homedir(), '.lzc-dtl.json');
        await fs.writeJson(configPath, config, { spaces: 2 });
    } catch (error) {
        console.warn('保存全局配置失败:', error.message);
    }
}

// Add this function to handle image processing
async function processImage(imageName, packageName, cache, globalConfig, serviceName) {
    // First check local cache
    let registryUrl = cache.registryUrl;
    
    // If not in local cache, check global config
    if (!registryUrl && globalConfig.registryUrl) {
        registryUrl = globalConfig.registryUrl;
    }
    
    // Generate cache key for this specific image - 使用完整的镜像名称
    const imageKey = `image_${imageName.replace(/[/:]/g, '_')}`;
    
    // 如果镜像缓���存在且有 newImageName，询问是否使用缓存的配置
    if (cache[imageKey]?.newImageName) {
        const useCacheAnswer = await inquirer.prompt([{
            type: 'confirm',
            name: 'useCache',
            message: `[${serviceName}] 发现已缓存的镜像置，是否使用？`,
            default: true
        }]);

        if (useCacheAnswer.useCache) {
            console.log(`[${serviceName}] 使用缓存的镜像配置: ${cache[imageKey].newImageName}`);
            return cache[imageKey].newImageName;
        }
    }
    
    // Ask if user wants to push to remote registry
    const pushAnswer = await inquirer.prompt([{
        type: 'confirm',
        name: 'push',
        message: `[${serviceName}] 是否需要推送镜像到远程仓库？`,
        default: cache[imageKey]?.push === undefined ? !!registryUrl : cache[imageKey]?.push
    }]);
    
    // 更新缓存时使用完整的对象结构
    let imageCache = {
        ...(cache[imageKey] || {}),
        originalImage: imageName,  // 保存原始镜像名
        push: pushAnswer.push
    };
    
    cache = await updateCache(cache, {
        [imageKey]: imageCache
    });
    
    if (!pushAnswer.push) {
        return imageName;
    }
    
    // Ask for registry URL if not available
    if (!registryUrl) {
        const registryAnswer = await inquirer.prompt([{
            type: 'input',
            name: 'url',
            message: '请输入远程仓库地址：',
            validate: input => input.trim() ? true : '仓库地址不能为空',
            default: cache[imageKey]?.registryUrl
        }]);
        
        registryUrl = registryAnswer.url;
        
        // Ask if want to save globally
        const saveGloballyAnswer = await inquirer.prompt([{
            type: 'confirm',
            name: 'save',
            message: '是否要全局保存该仓库地址？',
            default: true
        }]);
        
        if (saveGloballyAnswer.save) {
            await saveGlobalConfig({ ...globalConfig, registryUrl });
        }
        
        // 更新镜像缓存和全局注册表地址
        imageCache = {
            ...imageCache,
            registryUrl
        };
        
        cache = await updateCache(cache, {
            registryUrl,
            [imageKey]: imageCache
        });
    }
    
    // Generate new image name
    const packageBaseName = packageName.split('.').pop();
    const imageHash = crypto.createHash('md5').update(imageName).digest('hex');
    const newImageName = `${registryUrl}/${packageBaseName}:${imageHash}`;
    
    // 更新镜像缓存，保留之前的值
    imageCache = {
        ...imageCache,
        newImageName,
        timestamp: new Date().toISOString()  // 添加时间戳
    };
    
    cache = await updateCache(cache, {
        [imageKey]: imageCache
    });
    
    console.log(`[${serviceName}] 正在拉取原始镜像: ${imageName}`);
    await execCommand(`docker pull ${imageName}`);
    
    console.log(`[${serviceName}] 正在标记镜像: ${newImageName}`);
    await execCommand(`docker tag ${imageName} ${newImageName}`);
    
    console.log(`[${serviceName}] 正在推送镜像到远程仓库: ${newImageName}`);
    await execCommand(`docker push ${newImageName}`);
    
    return newImageName;
}

// Add this helper function to execute commands
async function execCommand(command) {
    const { exec } = require('child_process');
    return new Promise((resolve, reject) => {
        exec(command, (error, stdout, stderr) => {
            if (error) {
                reject(new Error(`执行命令失败: ${error.message}`));
                return;
            }
            resolve(stdout.trim());
        });
    });
}

module.exports = { convertApp }; 