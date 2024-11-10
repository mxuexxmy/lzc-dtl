const inquirer = require('inquirer');
const YAML = require('yaml');
const fs = require('fs-extra');
const path = require('path');
const archiver = require('archiver');
const tar = require('tar');
const dotenv = require('dotenv');

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

// 新增：保存选择到缓存
async function saveCache(cache) {
    try {
        const cachePath = path.join(process.cwd(), '.lzc-dtl-cache.json');
        await fs.writeJson(cachePath, cache, { spaces: 2 });
    } catch (error) {
        console.warn('保存缓存失败:', error.message);
    }
}

// 修改 updateCache 函数
async function updateCache(cache, updates) {
    const newCache = {
        ...cache
    };
    
    // 递归合并对象，确保布尔值正确处理
    for (const [key, value] of Object.entries(updates)) {
        if (value && typeof value === 'object' && !Array.isArray(value)) {
            newCache[key] = {
                ...(newCache[key] || {}),
                ...value
            };
        } else if (typeof value === 'boolean') {
            // 确保布尔值被正确保存
            newCache[key] = value;
        } else {
            newCache[key] = value;
        }
    }
    
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
            subdomain: answers.subdomain
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
                            message: '请��入支持的MIME类型（如 audio/mpeg）：',
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

        // 继续处理图标文件等其他配置...
    } else {
        // 使用命令行参数时，确保这两个值有效
        if (options.backgroundTask === undefined || options.backgroundTask === null) {
            throw new Error('在交互模式下必须指定 --background-task 选项');
        }
        if (options.multiInstance === undefined || options.multiInstance === null) {
            throw new Error('在非交互模式下必须指定 --multi-instance 选项');
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

    // 处理图标文件
    let iconPath = options.icon;
    if (!iconPath) {
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
        iconPath = iconAnswer.iconPath;
        
        // 使用辅助函数更新缓存
        cache = await updateCache(cache, { iconPath });
    }

    // 处理 docker-compose.yml
    let composePath = options.compose;
    if (!composePath) {
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
        composePath = composeAnswer.composePath;
        
        // 使用辅助函数更新缓存
        cache = await updateCache(cache, { composePath });
    }

    // 验证选择的
    try {
        const composeContent = await fs.readFile(composePath, 'utf8');
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
            version: '0.0.1',
            description: answers.description,
            homepage: answers.homepage,
            author: answers.author,
            application: {
                subdomain: answers.subdomain,
                background_task: answers.app_features?.includes('background_task') || false,
                multi_instance: answers.app_features?.includes('multi_instance') || false,
                gpu_accel: answers.app_features?.includes('gpu_accel') || false
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

            // 询问是否需要添加更多路由
            let addMore = true;
            while (addMore) {
                // 选择路由类型
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
                                const [hostPort, containerPort] = portMapping.split(':');
                                
                                // 生成一个更有结构的缓存键
                                const cacheKey = `port_mappings`;
                                const mappingKey = `${serviceName}_${portMapping}`;
                                
                                // 确保布尔值默认值正确处理
                                const usePortAnswer = await inquirer.prompt([{
                                    type: 'confirm',
                                    name: 'use',
                                    message: `是否添加服务 ${serviceName} 的端口映射 ${portMapping}？`,
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

                                        // 构建目标 URL，确保路径正确拼接
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
                                    return '请输入有效的端口号（1-65535）';
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

        // 在处理 services 的部分之前，直接在当前目录创建 content.tar
        const executionDir = process.cwd(); // 获取 lzc-dtl 执行的目录

        // 创建 content.tar，包含当前目录下的所有文件和目录
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

        // 修改 services 处理逻辑
        for (const [name, service] of Object.entries(composeData.services)) {
            // 检查服务是否有 image
            if (!service.image) {
                const imageActionAnswer = await inquirer.prompt([{
                    type: 'list',
                    name: 'action',
                    message: `服务 ${name} 没有指定镜像。请选择操作：`,
                    choices: [
                        { name: '输入镜像名', value: 'inputImage' },
                        { name: '自动构建并推送镜像', value: 'autoBuild' }
                    ],
                    default: cache[`${name}_image_action`] || 'inputImage'
                }]);

                if (imageActionAnswer.action === 'inputImage') {
                    const imageNameAnswer = await inquirer.prompt([{
                        type: 'input',
                        name: 'imageName',
                        message: `请输入服务 ${name} 的镜像名：`,
                        default: cache[`${name}_image_name`] || undefined
                    }]);
                    service.image = imageNameAnswer.imageName;
                    
                    // 使用辅助函数更新缓存
                    cache = await updateCache(cache, {
                        [`${name}_image_action`]: 'inputImage',
                        [`${name}_image_name`]: imageNameAnswer.imageName
                    });
                } else if (imageActionAnswer.action === 'autoBuild') {
                    const buildImageNameAnswer = await inquirer.prompt([{
                        type: 'input',
                        name: 'buildImageName',
                        message: `请输入服务 ${name} 的构建镜像名：`,
                        default: cache[`${name}_build_image_name`] || undefined
                    }]);

                    // 假设 buildContext 是服务的构建上下文路径
                    const buildContext = service.build.context || '.';
                    const dockerfilePath = service.build.dockerfile || 'Dockerfile';

                    // 执行 Docker 构建命令
                    const buildCommand = `docker build -t ${buildImageNameAnswer.buildImageName} -f ${dockerfilePath} ${buildContext}`;
                    console.log(`正在构建镜像：${buildCommand}`);
                    require('child_process').execSync(buildCommand, { stdio: 'inherit' });

                    // 执行 Docker 推送命令
                    const pushCommand = `docker push ${buildImageNameAnswer.buildImageName}`;
                    console.log(`正在推送镜像：${pushCommand}`);
                    require('child_process').execSync(pushCommand, { stdio: 'inherit' });

                    service.image = buildImageNameAnswer.buildImageName;
                    
                    // 使用辅助函数更新缓存
                    cache = await updateCache(cache, {
                        [`${name}_image_action`]: 'autoBuild',
                        [`${name}_build_image_name`]: buildImageNameAnswer.buildImageName
                    });
                }
            }

            manifest.services[name] = {
                image: service.image
            };

            // 修改 environment 处理部分
            if (service.env_file) {
                // Load environment variables from specified env_file
                const envFilePath = path.resolve(executionDir, service.env_file);
                const fileEnvConfig = dotenv.config({ path: envFilePath }).parsed || {};
                manifest.services[name].environment = Object.entries(fileEnvConfig).map(
                    ([key, value]) => `${key}=${value}`
                );
            } else if (service.environment) {
                // Handle inline environment variables
                if (Array.isArray(service.environment)) {
                    // 如果是数组格式，直接使用
                    manifest.services[name].environment = service.environment;
                } else {
                    // 如果是对象格式，转换为数组
                    manifest.services[name].environment = [];
                    for (const [key, value] of Object.entries(service.environment)) {
                        if (typeof value === 'string' && value.startsWith('${') && value.endsWith('}')) {
                            // Extract the variable name from ${VAR_NAME}
                            const envVarName = value.slice(2, -1);
                            // Replace with the value from the .env file or process.env
                            const envValue = envConfig[envVarName] || process.env[envVarName] || '';
                            manifest.services[name].environment.push(`${key}=${envValue}`);
                        } else {
                            manifest.services[name].environment.push(`${key}=${value}`);
                        }
                    }
                }
            }

            // 修改 volumes 处理部分
            if (service.volumes) {
                manifest.services[name].binds = [];
                
                for (const volume of service.volumes) {
                    // 移除注释部分
                    const volumeConfig = typeof volume === 'string' ? volume.split('#')[0].trim() : volume;
                    
                    // 如果移除注释后为空，跳过这个配置
                    if (!volumeConfig) continue;

                    let targetPath;
                    let sourcePath;

                    // 提取目标路径，不管是对象格式还是字符串格式
                    if (typeof volumeConfig === 'object') {
                        targetPath = volumeConfig.target;
                    } else {
                        // 先处理环境变量和默认值
                        let processedVolume = volumeConfig;
                        if (processedVolume.includes('${')) {
                            const envMatches = processedVolume.match(/\${[^}]+}/g);
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
                                    processedVolume = processedVolume.replace(match, envValue);
                                }
                            }
                        }

                        // 分割源路径和目标路径
                        const volumeParts = processedVolume.split(':');
                        if (volumeParts.length === 1) {
                            // 处理匿名卷
                            targetPath = volumeParts[0].trim();
                            const volumeName = path.basename(targetPath);
                            
                            // 询问用户如何处理匿名卷
                            const volumeActionAnswer = await inquirer.prompt([{
                                type: 'list',
                                name: 'action',
                                message: `如何处理匿名卷 ${targetPath}？`,
                                choices: [
                                    { name: '挂载空目录', value: 'emptyDir' },
                                    { name: '忽略挂载', value: 'ignore' }
                                ],
                                default: cache[`${name}_volume_${targetPath}_action`] || 'emptyDir'
                            }]);

                            // 更新缓存
                            cache = await updateCache(cache, {
                                [`${name}_volume_${targetPath}_action`]: volumeActionAnswer.action
                            });

                            if (volumeActionAnswer.action === 'emptyDir') {
                                const { bindMount, cache: newCache } = await promptMountLocation(name, targetPath, cache);
                                manifest.services[name].binds.push(bindMount);
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
                            // 命名卷直接使用 /lzcapp/var/data 目录
                            manifest.services[name].binds.push(`/lzcapp/var/data/${sourcePath}:${targetPath}`);
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
                            const directoryExists = await fs.pathExists(absoluteSourcePath);
                            if (directoryExists) {
                                choices.unshift({ name: '使用目录内容', value: 'useContent' });
                            }
                        }

                        // 询问用户如何处理挂载
                        const volumeActionAnswer = await inquirer.prompt([{
                            type: 'list',
                            name: 'action',
                            message: `如何处理挂载点 ${targetPath}？`,
                            choices: choices,
                            default: cache[`${name}_volume_${targetPath}_action`] || (sourcePath ? 'useContent' : 'emptyDir')
                        }]);

                        // 更新缓存
                        cache = await updateCache(cache, {
                            [`${name}_volume_${targetPath}_action`]: volumeActionAnswer.action
                        });

                        if (volumeActionAnswer.action === 'useContent' && sourcePath) {
                            // 对于相对路径或绝对路径，使用 /lzcapp/pkg/content 中的内容
                            const relativePath = path.relative(executionDir, absoluteSourcePath);
                            // 使用 posix 风格的路径
                            const posixPath = relativePath.split(path.sep).join(path.posix.sep);
                            manifest.services[name].binds.push(`/lzcapp/pkg/content/${posixPath}:${targetPath}`);
                        } else if (volumeActionAnswer.action === 'emptyDir') {
                            const { bindMount, cache: newCache } = await promptMountLocation(name, targetPath, cache);
                            manifest.services[name].binds.push(bindMount);
                            cache = newCache;  // 更新缓存
                        }
                    }
                }
            }
 
            if (service.command) {
                manifest.services[name].command = service.command;
            }

            if (service.depends_on) {
                manifest.services[name].depends_on = service.depends_on;
            }
        }

        // 写入 manifest.yml
        await fs.writeFile('manifest.yml', YAML.stringify(manifest));

        // 复制图标文件，如果源文件和目标文件不同才复制
        const iconDestPath = path.join(process.cwd(), 'icon.png');
        if (path.resolve(iconPath) !== path.resolve(iconDestPath)) {
            await fs.copy(iconPath, iconDestPath);
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

module.exports = { convertApp }; 