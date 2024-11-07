const inquirer = require('inquirer');
const YAML = require('yaml');
const fs = require('fs-extra');
const path = require('path');
const archiver = require('archiver');
const tar = require('tar');
const dotenv = require('dotenv');

// 新增：获取目录下的文件列表
async function getFilesList(extensions) {
    const files = await fs.readdir(process.cwd());
    return files.filter(file => {
        if (!extensions) return true;
        const ext = path.extname(file).toLowerCase();
        return extensions.includes(ext);
    });
}

async function convertApp(options = {}) {
    let answers;
    
    // 如果没有通过命令行参数提供完整信息，则通过交互式提示收集
    if (!options.nonInteractive) {
        const questions = [];
        
        if (!options.name) {
            questions.push({
                type: 'input',
                name: 'name',
                message: '请输入应用名称：'
            });
        }
        if (!options.package) {
            questions.push({
                type: 'input',
                name: 'package',
                message: '请输入应用包名：'
            });
        }
        if (!options.description) {
            questions.push({
                type: 'input',
                name: 'description',
                message: '请输入应用描述：'
            });
        }
        if (!options.homepage) {
            questions.push({
                type: 'input',
                name: 'homepage',
                message: '请输入应用首页：'
            });
        }
        if (!options.author) {
            questions.push({
                type: 'input',
                name: 'author',
                message: '请输入作者：'
            });
        }
        if (options.backgroundTask === undefined || options.backgroundTask === null) {
            questions.push({
                type: 'confirm',
                name: 'background_task',
                message: '是否开机自启？'
            });
        }
        if (options.multiInstance === undefined || options.multiInstance === null) {
            questions.push({
                type: 'confirm',
                name: 'multi_instance',
                message: '是否多用户共享？'
            });
        }
        if (!options.publicPaths) {
            questions.push({
                type: 'input',
                name: 'public_paths',
                message: '需要对外暴露的页面（用逗号分隔）：',
                default: '/'
            });
        }
        if (!options.subdomain) {
            questions.push({
                type: 'input',
                name: 'subdomain',
                message: '请输入子域名：'
            });
        }

        const promptAnswers = await inquirer.prompt(questions);
        answers = {
            ...options,
            ...promptAnswers,
            background_task: options.backgroundTask !== undefined ? options.backgroundTask : promptAnswers.background_task,
            multi_instance: options.multiInstance !== undefined ? options.multiInstance : promptAnswers.multi_instance,
            public_paths: options.publicPaths || promptAnswers.public_paths
        };
    } else {
        // 使用命令行参数时，确保这两个值有效
        if (options.backgroundTask === undefined || options.backgroundTask === null) {
            throw new Error('在非交互模式下必须指定 --background-task 选项');
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
            public_paths: options.publicPaths,
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
            pageSize: 10
        }]);
        iconPath = iconAnswer.iconPath;
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
            pageSize: 10
        }]);
        composePath = composeAnswer.composePath;
    }

    // 验证选择的文件
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
                background_task: answers.background_task,
                multi_instance: answers.multi_instance,
                public_path: answers.public_paths.split(','),
                subdomain: answers.subdomain
            },
            services: {}
        };

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
                    choices: routeTypes
                }]);

                if (routeTypeAnswer.type === 'from_compose') {
                    // 从 docker-compose 读取端口
                    for (const [serviceName, service] of Object.entries(composeData.services)) {
                        if (service.ports) {
                            for (const portMapping of service.ports) {
                                const [hostPort, containerPort] = portMapping.split(':');
                                
                                // 询问是否要添加这个端口映射
                                const usePortAnswer = await inquirer.prompt([{
                                    type: 'confirm',
                                    name: 'use',
                                    message: `是否添加服务 ${serviceName} 的端口映射 ${portMapping}？`,
                                    default: true
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
                                        ]
                                    }]);

                                    if (routeTypeForPort.type === 'port') {
                                        // 询问协议类型
                                        const protocolAnswer = await inquirer.prompt([{
                                            type: 'list',
                                            name: 'protocol',
                                            message: '请选择协议：',
                                            choices: ['tcp', 'udp']
                                        }]);

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
                                            default: '/'
                                        }]);

                                        routes.push({
                                            type: 'http',
                                            config: {
                                                path: pathAnswer.path,
                                                target: `${routeTypeForPort.type}://${serviceName}.${answers.package}.lzcapp:${containerPort}/`
                                            }
                                        });
                                    }
                                }
                            }
                        }
                    }
                } else if (routeTypeAnswer.type === 'port') {
                    // TCP/UDP端口暴露配置
                    const portConfig = await inquirer.prompt([
                        {
                            type: 'list',
                            name: 'protocol',
                            message: '请选择协议：',
                            choices: ['tcp', 'udp']
                        },
                        {
                            type: 'input',
                            name: 'port',
                            message: '请输入端口号：',
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
                            choices: services
                        }
                    ]);

                    routes.push({
                        type: 'ingress',
                        config: {
                            protocol: portConfig.protocol,
                            port: parseInt(portConfig.port),
                            service: portConfig.service
                        }
                    });
                } else {
                    // HTTP/HTTPS路由配置
                    const httpConfig = await inquirer.prompt([
                        {
                            type: 'input',
                            name: 'path',
                            message: '请输入路由路径（如 /api/）：',
                            default: '/'
                        },
                        {
                            type: 'list',
                            name: 'service',
                            message: '请选择服务：',
                            choices: services
                        },
                        {
                            type: 'input',
                            name: 'port',
                            message: '请输入服务端口：',
                            validate: (input) => {
                                const port = parseInt(input);
                                if (isNaN(port) || port < 1 || port > 65535) {
                                    return '请输入有效的端口号（1-65535）';
                                }
                                return true;
                            }
                        }
                    ]);

                    const protocol = routeTypeAnswer.type;
                    routes.push({
                        type: 'http',
                        config: {
                            path: httpConfig.path,
                            target: `${protocol}://${httpConfig.service}.${answers.package}.lzcapp:${httpConfig.port}/`
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

        // 添加端口暴露配置
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
                    default: 'inputImage'
                }]);

                if (imageActionAnswer.action === 'inputImage') {
                    const imageNameAnswer = await inquirer.prompt([{
                        type: 'input',
                        name: 'imageName',
                        message: `请输入服务 ${name} 的镜像名：`
                    }]);
                    service.image = imageNameAnswer.imageName;
                } else if (imageActionAnswer.action === 'autoBuild') {
                    const buildImageNameAnswer = await inquirer.prompt([{
                        type: 'input',
                        name: 'buildImageName',
                        message: `请输入服务 ${name} 的构建镜像名：`
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
                }
            }

            manifest.services[name] = {
                image: service.image
            };

            // 处理 environment
            if (service.env_file) {
                // Load environment variables from specified env_file
                const envFilePath = path.resolve(executionDir, service.env_file);
                const fileEnvConfig = dotenv.config({ path: envFilePath }).parsed || {};
                manifest.services[name].environment = Object.entries(fileEnvConfig).map(
                    ([key, value]) => `${key}=${value}`
                );
            } else if (service.environment) {
                // Handle inline environment variables
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

            // 处理 volumes
            if (service.volumes) {
                manifest.services[name].volumes = [];
                
                for (const volume of service.volumes) {
                    const parts = volume.split(':');
                    const sourcePath = parts[0];
                    const targetPath = parts[1];
                    
                    // 检查目录是否存在
                    const absoluteSourcePath = path.resolve(executionDir, sourcePath);
                    const directoryExists = await fs.pathExists(absoluteSourcePath);

                    let choices = [
                        { name: '挂载空目录', value: 'emptyDir' },
                        { name: '忽略挂载', value: 'ignore' }
                    ];

                    if (directoryExists) {
                        choices.unshift({ name: '使用目录内容', value: 'useContent' });
                    }

                    // 询问用户如何处理挂载
                    const volumeActionAnswer = await inquirer.prompt([{
                        type: 'list',
                        name: 'action',
                        message: `如何处理目录 ${sourcePath} 的挂载？`,
                        choices: choices,
                        default: directoryExists ? 'useContent' : 'emptyDir'
                    }]);

                    if (volumeActionAnswer.action === 'useContent') {
                        if (!sourcePath.startsWith('/') && !sourcePath.startsWith('./') && !sourcePath.startsWith('../')) {
                            // 命名卷，使用 /lzcapp/var/data
                            manifest.services[name].volumes.push(`/lzcapp/var/data/${sourcePath}:${targetPath}`);
                            continue;
                        }

                        // 对于相对路径或绝对路径，都使用 /lzcapp/pkg/content 中的内容
                        const relativePath = path.relative(executionDir, absoluteSourcePath);
                        manifest.services[name].volumes.push(`/lzcapp/pkg/content/${relativePath}:${targetPath}`);
                    } else if (volumeActionAnswer.action === 'emptyDir') {
                        // 挂载空目录
                        manifest.services[name].volumes.push(`/lzcapp/var/data/${path.basename(sourcePath)}:${targetPath}`);
                    }
                    // If the action is 'ignore', do nothing
                }
            }

            if (service.binds) {
                manifest.services[name].binds = service.binds.map(bind => {
                    const [src, dest] = bind.split(':');
                    return `/lzcapp/var/${path.basename(src)}:${dest}`;
                });
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

        console.log('转换完成！');
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

module.exports = { convertApp }; 