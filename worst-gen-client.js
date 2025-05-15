#!/usr/bin/env node

const crypto = require('crypto');
const { io } = require('socket.io-client');
const readline = require('readline');
const chalk = require('chalk');
const figlet = require('figlet');
const boxen = require('boxen');
const gradient = require('gradient-string');
const ora = require('ora');
const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');

// Parse command line arguments
const argv = yargs(hideBin(process.argv))
  .option('server', {
    alias: 's',
    type: 'string',
    description: 'Chat server URL',
    default: 'https://worst-generation.onrender.com'
  })
  .option('alias', {
    alias: 'a',
    type: 'string',
    description: 'Your hacker alias'
  })
  .option('key', {
    alias: 'k',
    type: 'string',
    description: 'Server registration key (only needed for first-time setup)'
  })
  .help()
  .argv;

// Config
const SERVER_URL = argv.server;

// Generate keypair for encryption/decryption
const generateKeypair = () => {
  return crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: {
      type: 'spki',
      format: 'pem'
    },
    privateKeyEncoding: {
      type: 'pkcs8',
      format: 'pem'
    }
  });
};

// Encryption/decryption functions
const encryptMessage = (text, publicKey) => {
  const iv = crypto.randomBytes(16);
  const key = crypto.randomBytes(32);
  
  // Encrypt the actual message with AES
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  
  // Encrypt the AES key with RSA public key
  const encryptedKey = crypto.publicEncrypt(
    {
      key: publicKey,
      padding: crypto.constants.RSA_PKCS1_OAEP_PADDING
    },
    Buffer.from(key.toString('hex'), 'utf8')
  ).toString('base64');
  
  return {
    encryptedContent: encrypted,
    encryptedKey,
    iv: iv.toString('hex')
  };
};

const decryptMessage = (encryptedContent, encryptedKey, iv, privateKey) => {
  try {
    // Decrypt the AES key with RSA private key
    const key = crypto.privateDecrypt(
      {
        key: privateKey,
        padding: crypto.constants.RSA_PKCS1_OAEP_PADDING
      },
      Buffer.from(encryptedKey, 'base64')
    );
    
    // Use the AES key to decrypt the message
    const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(key.toString(), 'hex'), Buffer.from(iv, 'hex'));
    let decrypted = decipher.update(encryptedContent, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  } catch (error) {
    return '[encrypted message - cannot decrypt]';
  }
};

// Start client
async function startClient() {
  // Generate or retrieve keypair
  const { publicKey, privateKey } = generateKeypair();
  
  console.clear();
  console.log(gradient.mind(figlet.textSync('Worst Generation', { 
    font: 'Cyber',
    horizontalLayout: 'full'
  })));
  
  console.log(boxen(chalk.green('\n[ Terminal Hacking Collective ]\n'), { 
    padding: 1, borderStyle: 'double', borderColor: 'green' 
  }));
  
  // Connect to server
  const spinner = ora('Connecting to secure server...').start();
  const socket = io(SERVER_URL);
  
  // Handle connection errors
  socket.on('connect_error', (error) => {
    spinner.fail(`Failed to connect to ${SERVER_URL}`);
    console.error(chalk.red('Connection error:'), error.message);
    process.exit(1);
  });
  
  // On successful connection
  socket.on('connect', async () => {
    spinner.succeed(`Connected to ${SERVER_URL}`);
    
    // Determine alias
    let alias = argv.alias;
    if (!alias) {
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
      });
      
      alias = await new Promise(resolve => {
        rl.question(chalk.cyan('Enter your alias: '), (answer) => {
          rl.close();
          resolve(answer.trim());
        });
      });
      
      if (!alias) {
        console.log(chalk.red('Alias cannot be empty.'));
        process.exit(1);
      }
    }
    
    const keySpinner = ora('Authenticating...').start();
    
    // Try to login first
    socket.emit('login', {
      alias,
      publicKey: publicKey
    });
    
    // Handle successful login
    socket.on('login-success', (data) => {
      keySpinner.succeed(`Logged in as ${alias}`);
      setupChat(socket, alias, publicKey, privateKey, data.history || []);
    });
    
    // Handle registration if login fails
    socket.on('error', (error) => {
      if (error.message === 'Unknown alias') {
        // Need to register - check for key
        const registrationKey = argv.key;
        if (!registrationKey) {
          keySpinner.fail('Registration key required for new users.');
          console.log(chalk.yellow('Please run again with --key or -k flag to provide the registration key'));
          process.exit(1);
        }
        
        keySpinner.text = 'Registering new alias...';
        
        // Register new user
        socket.emit('register', {
          alias,
          publicKey: publicKey,
          registrationKey
        });
        
        socket.on('registered', (data) => {
          if (data.success) {
            keySpinner.succeed(`Registered as ${alias}`);
            setupChat(socket, alias, publicKey, privateKey, []);
          } else {
            keySpinner.fail('Registration failed');
            console.error(chalk.red('Error:'), data.message);
            process.exit(1);
          }
        });
      } else {
        keySpinner.fail('Authentication error');
        console.error(chalk.red('Error:'), error.message);
        process.exit(1);
      }
    });
  });
}

// Setup chat interface
function setupChat(socket, alias, publicKey, privateKey, history) {
  console.clear();
  console.log(gradient.atlas(figlet.textSync('Worst Generation', { font: 'Graffiti' })));
  
  console.log(boxen(
    chalk.green(`Connected as: ${alias}\n`) +
    chalk.yellow('Type your message and press Enter to send\n') +
    chalk.yellow('Type /quit to exit the chat'),
    { padding: 1, borderStyle: 'round', borderColor: 'green' }
  ));
  
  // Show chat history if available
  console.log(chalk.cyan('\n=== Chat History ==='));
  history.forEach(msg => {
    const timestamp = new Date(msg.timestamp).toLocaleTimeString();
    if (msg.sender === alias) {
      console.log(`${chalk.green(`${msg.sender} [${timestamp}]`)}: ${msg.encryptedContent}`);
    } else {
      console.log(`${chalk.blue(`${msg.sender} [${timestamp}]`)}: ${msg.encryptedContent}`);
    }
  });
  console.log(chalk.cyan('==================\n'));
  
  // Setup input handling
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: `${alias} > `
  });
  
  rl.prompt();
  
  // Message input handler
  rl.on('line', (line) => {
    const message = line.trim();
    
    if (message === '/quit') {
      console.log(chalk.yellow('Disconnecting from the Worst Generation network...'));
      socket.disconnect();
      rl.close();
      process.exit(0);
    }
    
    if (message !== '') {
      // Encrypt message
      const { encryptedContent, encryptedKey, iv } = encryptMessage(message, publicKey);
      
      // Send to server
      socket.emit('message', {
        encryptedContent,
        encryptedKey,
        iv
      });
      
      // Local echo
      console.log(`${chalk.green(`${alias} [${new Date().toLocaleTimeString()}]`)}: ${message}`);
    }
    
    rl.prompt();
  });
  
  // Message received handler
  socket.on('message', (data) => {
    if (data.sender !== alias) {
      const timestamp = new Date(data.timestamp).toLocaleTimeString();
      let displayMessage;
      
      try {
        // Try to decrypt - in a real app, you'd use the other user's public key
        displayMessage = data.encryptedContent; // just showing encrypted content for demo
      } catch (err) {
        displayMessage = data.encryptedContent;
      }
      
      console.log(`${chalk.blue(`${data.sender} [${timestamp}]`)}: ${displayMessage}`);
      rl.prompt();
    }
  });
  
  // User joined notification
  socket.on('user-joined', (data) => {
    console.log(chalk.yellow(`>> ${data.alias} joined the chat <<`));
    rl.prompt();
  });
  
  // User left notification
  socket.on('user-left', (data) => {
    console.log(chalk.yellow(`>> ${data.alias} left the chat <<`));
    rl.prompt();
  });
  
  // Handle disconnect
  socket.on('disconnect', () => {
    console.log(chalk.red('\nDisconnected from server.'));
    rl.close();
    process.exit(0);
  });
}

// Start the client
startClient();
