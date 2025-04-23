import http from 'http';
import https from 'https';
import url from 'url';
import fs from 'fs';
import express, { CookieOptions, NextFunction, Request, Response, response } from 'express';
import { Document, MongoClient, ObjectId, WithId } from 'mongodb';
import cors from 'cors';
import fileUpload from 'express-fileupload';
import jwt from 'jsonwebtoken';
import cookieParser from 'cookie-parser';
import nodeMailer from 'nodemailer';
import dotenv from 'dotenv';
import bcrypt from 'bcrypt';
import { google } from 'googleapis';
import { v2 as cloudinary } from 'cloudinary';

const app = express();
let mongoClient: MongoClient;

let paginaErr: string;

// Config
dotenv.config({ path: '.env' });
const connectionString = process.env.connectionStringAtlas;
const DB_NAME = process.env.dbName;
const PORT = 3000; // Change to HTTP port 3000
const tokenExpiresIn = 14400; // invece di 240
// const auth = JSON.parse(process.env.auth);

// Configura Cloudinary con le credenziali dal file .env
const cloudinaryConfig = JSON.parse(process.env.cloudinaryConfig);
cloudinary.config({
    cloud_name: cloudinaryConfig.cloud_name,
    api_key: cloudinaryConfig.api_key,
    api_secret: cloudinaryConfig.api_secret
});

// Initialize MongoDB and HTTP server
async function initServer() {
  try {
    // MongoDB connection
    mongoClient = new MongoClient(connectionString);
    await mongoClient.connect();
    console.log("Connected to MongoDB Atlas");

    // Read error page
    init();

    // Create HTTP server and start listening
    app.listen(PORT, () => {
      console.log(`Server HTTP in ascolto sulla porta ${PORT}`);
    });

  } catch (err) {
    console.error("Errore di inizializzazione:", err);
    process.exit(1);
  }
}

// Start server
initServer().catch(err => {
  console.error("Failed to start server:", err);
  process.exit(1);
});

function init() {
  fs.readFile('./static/error.html', (err, data) => {
    if (!err) {
      paginaErr = data.toString();
    } else {
      paginaErr = '<h1>Not Found</h1>';
    }
  });
}

/* ********************** HTTP server ********************** */
const jwtKey = fs.readFileSync('./keys/jwtKey', 'utf8');

//Middleware
//1. Request log
app.use('/', (req: any, res: any, next: any) => {
  console.log(req.method + ': ' + req.originalUrl);
  next();
});

//2. Static resource
app.use('/', express.static('./static'));

//3. Body params
//Queste due entry ervono per agganciare i parametri nel body
app.use('/', express.json({ limit: '10mb' }));
app.use('/', express.urlencoded({ limit: '10mb', extended: true }));

//4. Upload config
app.use('/', fileUpload({ limits: { fileSize: 10 * 1024 * 1024 } }));

//5. Params log
app.use('/', (req: any, res: any, next: any) => {
  if (Object.keys(req.query).length > 0) {
    console.log('--> parametri  GET: ' + JSON.stringify(req.query));
  }
  if (Object.keys(req.body).length > 0) {
    console.log('--> parametri  BODY: ' + JSON.stringify(req.body));
  }
  next();
});

//6. CORS
const whitelist = [
  'http://localhost:3000',
  'http://localhost:4200', // server angular
  'https://cordovaapp' // porta 443 (default)
];

const corsOptions = {
  origin: function (origin, callback) {
    if (!origin)
      // browser direct call
      return callback(null, true);
    if (whitelist.indexOf(origin) === -1) {
      var msg = `The CORS policy for this site does not
    allow access from the specified Origin.`;
      return callback(new Error(msg), false);
    } else return callback(null, true);
  },
  credentials: true
};
app.use('/', cors(corsOptions));

// 7. Gestione login
app.use(cookieParser()); // Aggiunge un campo cookies nella response e nella request
const cookiesOptions: CookieOptions = {
  path: '/',
  maxAge: tokenExpiresIn * 1000,
  httpOnly: true,
  secure: false,
  sameSite: 'lax'  // Cambiato da false a 'lax'
};

// Modifica la route di login per controllare se è necessario cambiare la password
app.post('/api/login', async (req: Request, res: Response) => {
    try {
        const collection = mongoClient.db(DB_NAME).collection('utenti');
        const user = await collection.findOne({ username: req.body.username });

        if (!user || user.password !== req.body.password) {
            res.status(401).send("Username o password non validi");
            return;
        }

        // Check if password needs to be changed
        const requiresPwdChange = user.password === 'password';
        
        // Determina il ruolo e la pagina di redirect
        const isAdmin = user.username === 'Admin';
        const userWithRole = {
            ...user,
            role: isAdmin ? 'admin' : 'operator'
        };

        const token = createToken(userWithRole);
        res.cookie('token', token, cookiesOptions);
        res.send({ 
            ris: 'ok',
            requiresPwdChange: requiresPwdChange,
            redirect: isAdmin ? 'index.html' : 'operator.html'
        });
    } catch (err) {
        console.error("Login error:", err);
        res.status(500).send("Errore del server");
    }
});

// 8. Google login
app.post('/api/googleLogin', async (req: Request, res: Response) => {
  const payload: any = jwt.decode(req.body.googleToken);
  const username = payload.email;

  const client = new MongoClient(connectionString);
  await client.connect().catch(err => {
    res.status(503).send('Errore connessione al database: ' + DB_NAME);
  });
  const collection = client.db(DB_NAME).collection('mail');
  const regex = new RegExp(`^${username}$`, 'i');
  const request = collection.findOne({ username: regex });
  request.catch(err => {
    res.status(500).send('Errore esecuzione query');
    client.close();
  });
  request.then(dbUser => {
    if (!dbUser) {
      const newUser = {
        username: username,
        password: '',
        mail: []
      };
      const request2 = collection.insertOne(newUser);
      request2.catch(err => {
        res.status(500).send('Errore inserimento nuovo utente');
      });
      request2.then(mongoResponse => {
        console.log('Mongo: ', mongoResponse.insertedId.toString());
        const token = createToken(newUser);
        res.cookie('token', token, cookiesOptions);
        res.send({ ris: 'ok' });
      });
      request2.finally(() => {
        client.close();
      });
    } else {
      const token = createToken(dbUser);
      res.cookie('token', token, cookiesOptions);
      res.send({ ris: 'ok' });
      client.close();
    }
  });
});

// 9. Logout
app.post('/api/logout', (req: Request, res: Response, next: NextFunction) => {
  let options = {
    ...cookiesOptions,
    maxAge: -1
  };
  res.cookie('token', '', options).send({ ris: 'Ok' });
});

//10. oAuth2 Configuration
const oAuth2Credentials = JSON.parse(process.env.OAuth2 as any);
const OAuth2 = google.auth.OAuth2; // oggetto OAuth2
// L’oggetto OAuth2 serve per richiedere il Bearer Token
const OAuth2Client = new OAuth2(oAuth2Credentials['client_id'], oAuth2Credentials['client_secret']);
OAuth2Client.setCredentials({
  refresh_token: oAuth2Credentials.refresh_token
});
let auth2Options: any = {
  type: 'OAuth2',
  user: 's.bernardi.2625@vallauri.edu',
  clientId: oAuth2Credentials.client_id,
  clientSecret: oAuth2Credentials.client_secret,
  refreshToken: oAuth2Credentials.refresh_token,
  accessToken: '' //rigenerato ogni volta
};
const message = fs.readFileSync('./message.html', 'utf-8');

//11. Password Dimenticata
app.post('/api/pwdDimenticata', async function (req: any, res: any, next: any) {
  let username = req.body.username;
  const client = new MongoClient(connectionString);
  await client.connect().catch(function (err) {
    res.status(503).send('Errore connessione al Database');
  });
  const collection = client.db(DB_NAME).collection('mail');
  const regex = new RegExp('^' + username + '$', 'i');
  const request = collection.findOne({ username: regex });
  request.catch(function (err) {
    res.status(500).send('Errore esecuzione query ' + err.message);
    client.close();
  });
  request.then(async function (dbUser) {
    if (!dbUser) {
      res.status(401).send('Username non valido');
      client.close();
    } else {
      let newPwd = '';
      for (let i = 0; i < 12; i++) {
        newPwd += String.fromCharCode(Math.floor(Math.random() * 26) + 65);
      }
      let msg = message.replace('__user', username).replace('__password', newPwd);
      auth2Options.accessToken = await OAuth2Client.getAccessToken();

      const trasporter = nodeMailer.createTransport({
        service: 'gmail',
        auth: auth2Options
      });

      const mailOptions = {
        from: auth2Options.user,
        to: username,
        subject: 'Nuova Password Per Rilievi e Perizie',
        html: msg,
        attachments: [
          {
            filename: 'qrCode.png',
            path: './qrCode.png'
          }
        ]
      };

      trasporter.sendMail(mailOptions, function (err: any, info: any) {
        if (err) {
          res.status(500).send('Errore Invio Mai ' + err.message);
          client.close();
        } else {
          res.send({ ris: 'OK' });
          trasporter.close();
          const request2 = collection.updateOne({ username: regex }, { $set: { password: bcrypt.hashSync(newPwd, 10), oldPass: newPwd } });
          request2.catch(err => {
            console.log(err.stack);
            res.status(500).send('Errore aggiornamento password');
          });
          request2.then(data => {
            console.log('Aggiornata password');
            res.send({ ris: 'OK' });
          });
          request2.finally(() => {
            client.close();
          });
        }
      });
    }
  });
  request.finally(function () {
    client.close();
  });
});

// 12. Controllo token
app.use('/api/', (req: Request, res: Response, next: NextFunction) => {
  if (!req.cookies.token) {
    res.status(403).send('token mancante');
  } else {
    const token = req.cookies.token;
    jwt.verify(token, jwtKey, (err: any, payload: any) => {
      if (err) {
        res.status(403).send('token non valido o scaduto');
      } else {
        // Rinnova il token solo se sta per scadere (meno di 60 secondi alla scadenza)
        const now = Math.floor(Date.now() / 1000);
        if (payload.exp - now < 60) {
          let newToken = createToken(payload);
          res.cookie('token', newToken, cookiesOptions);
        }
        req['payload'] = payload;
        next();
      }
    });
  }
});

//Client routes

// API per le perizie
app.get("/api/perizie", async (req: any, res: any) => {
    const client = new MongoClient(connectionString);
    try {
        await client.connect();
        const collection = client.db(DB_NAME).collection('perizie');
        let query: any = {};
        
        if (req.query.operatore) {
            const operatoreId = req.query.operatore.replace(/\?$/, '');
            query.codOperatore = operatoreId;
        }

        if (req.query.dateFrom || req.query.dateTo) {
            query['data-ora'] = {
                ...(req.query.dateFrom && { $gte: new Date(req.query.dateFrom) }),
                ...(req.query.dateTo && { $lte: new Date(req.query.dateTo) })
            };
        }

        const perizie = await collection.find(query).toArray();
        res.json(perizie);
    } catch (err) {
        res.status(500).send("Errore nel recupero delle perizie");
    } finally {
        await client.close();
    }
});

// API per gli operatori
app.get('/api/operators', async (req: Request, res: Response) => {
  try {
    const collection = mongoClient.db(DB_NAME).collection('utenti');
    const operators = await collection.find({ role: { $ne: 'admin' } }).toArray();
    res.json(operators);
  } catch (err) {
    res.status(500).send("Errore nel recupero degli operatori");
  }
});

// API per aggiungere un nuovo operatore
app.post('/api/addOperator', async (req: any, res: any , next: any) => {
  if (req['payload'].role !== 'admin') {
    return res.status(403).send('Non autorizzato');
  }

  try {
    const collection = mongoClient.db(DB_NAME).collection('utenti');
    const newOperator = {
      username: req.body.email,
      password: 'password', // Password iniziale
      role: 'operator',
      nPerizie: 0,
      img: "https://www.w3schools.com/howto/img_avatar2.png"
    };

    await collection.insertOne(newOperator);
    res.json({ message: 'Operatore aggiunto con successo' });
  } catch (err) {
    res.status(500).send("Errore nell'aggiunta dell'operatore");
  }
});

// API per modificare una perizia
app.put("/api/perizie/:id", async (req: any, res: any, next: any) => {
    if (req['payload'].role !== 'admin') {
        return res.status(403).send('Non autorizzato');
    }

    const client = new MongoClient(connectionString);
    await client.connect();
    const collection = client.db(DB_NAME).collection('perizie');
    
    collection.updateOne(
        { _id: new ObjectId(req.params.id) },
        { $set: {
            descrizione: req.body.descrizione,
            foto: req.body.foto
        }}
    )
    .catch(err => {
        res.status(500).send("Errore aggiornamento perizia: " + err);
    })
    .then(() => {
        res.send({ message: 'Perizia aggiornata con successo' });
    })
    .finally(() => {
        client.close();
    });
});

// Get single perizia by ID
app.get("/api/perizie/:id", async (req: any, res: any) => {
    const client = new MongoClient(connectionString);
    try {
        await client.connect();
        const collection = client.db(DB_NAME).collection('perizie');
        
        // Convert string ID to ObjectId
        const periziaId = new ObjectId(req.params.id);
        
        const perizia = await collection.findOne({ _id: periziaId });
        
        if (!perizia) {
            res.status(404).send("Perizia non trovata");
            return;
        }
        
        res.json(perizia);
    } catch (err) {
        console.error("Error fetching perizia:", err);
        res.status(500).send("Errore nel recupero della perizia");
    } finally {
        await client.close();
    }
});

// Aggiungi questa route dopo le altre API
app.get("/api/checkUser", async (req: any, res: any, next: any) => {
    if (!req['payload']) {
        return res.status(401).send('Non autorizzato');
    }

    const client = new MongoClient(connectionString);
    try {
        await client.connect();
        const collection = client.db(DB_NAME).collection('utenti');
        const user = await collection.findOne({ 
            username: req['payload'].username 
        });

        if (!user) {
            res.status(401).send('Utente non trovato');
            return;
        }

        // Non inviare la password
        const { password, ...userWithoutPassword } = user;
        res.json(userWithoutPassword);
    } catch (err) {
        console.error(err);
        res.status(500).send('Errore del server');
    } finally {
        await client.close();
    }
});

app.post("/api/perizie", async (req: any, res: any) => {
    if (!req['payload']) {
        return res.status(401).send('Non autorizzato');
    }

    const client = new MongoClient(connectionString);
    try {
        await client.connect();
        const db = client.db(DB_NAME);
        
        // Gestisci il caricamento delle foto su Cloudinary
        const fotoJson = JSON.parse(req.body.foto);
        const uploadedFoto = await Promise.all(fotoJson.map(async (foto: any) => {
            // Carica l'immagine su Cloudinary
            const uploadResponse = await cloudinary.uploader.upload(foto.img, {
                folder: 'perizie',
                resource_type: 'auto'
            });
            
            return {
                img: uploadResponse.secure_url,
                cloudinaryId: uploadResponse.public_id,
                commento: foto.commento || ''
            };
        }));

        // Crea la nuova perizia con i link Cloudinary
        const newPerizia = {
            codOperatore: new ObjectId(req['payload']._id),
            "data-ora": new Date(),
            coordinate: {
                latitude: parseFloat(req.body.latitude),
                longitude: parseFloat(req.body.longitude)
            },
            descrizione: req.body.descrizione,
            foto: uploadedFoto
        };

        const perizie = db.collection('perizie');
        const risultato = await perizie.insertOne(newPerizia);

        // Incrementa il contatore nPerizie dell'operatore
        const utenti = db.collection('utenti');
        await utenti.updateOne(
            { _id: new ObjectId(req['payload']._id) },
            { $inc: { nPerizie: 1 } }
        );

        res.json({ 
            message: 'Perizia salvata con successo',
            _id: risultato.insertedId 
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('Errore durante il salvataggio della perizia');
    } finally {
        await client.close();
    }
});

// Aggiungi la route per il cambio password
app.post('/api/changePassword', async (req: Request, res: Response) => {
    try {
        const collection = mongoClient.db(DB_NAME).collection('utenti');
        
        // Update password
        await collection.updateOne(
            { username: req.body.username },
            { 
                $set: { 
                    password: req.body.newPassword,
                    passwordChanged: true
                } 
            }
        );

        res.json({ message: 'Password updated successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).send("Errore durante l'aggiornamento della password");
    }
});

//Default Route & Error Handler
app.use('/', (req: any, res: any, next: any) => {
  res.status(404);
  if (!req.originalUrl.startsWith('/api/')) {
    res.send(paginaErr);
  } else {
    res.send('Not Found: Resource ' + req.originalUrl);
  }
});

app.use((err: any, req: any, res: any, next: any) => {
  console.log(err.stack);
  res.status(500).send(err.message);
});

// Modifica anche la funzione createToken per includere il ruolo admin
function createToken(data: any) {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iat: now,
    exp: now + tokenExpiresIn,
    _id: data._id || new ObjectId(),
    username: data.username,
    role: data.username === 'Admin' ? 'admin' : 'user'
  };
  return jwt.sign(payload, jwtKey);
}

// Basic middleware setup
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors({
  origin: 'https://localhost:3001',
  credentials: true
}));
app.use(cookieParser());
app.use(express.static('static'));

// Test route
app.get('/test', (req, res) => {
  res.json({ message: 'Server is working!' });
});
