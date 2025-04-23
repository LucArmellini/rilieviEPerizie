// import
import bcrypt from 'bcrypt'; // + @types
import { MongoClient, ObjectId } from 'mongodb';
import dotenv from 'dotenv';
dotenv.config({ path: '.env' });

// mongo
const connectionString: string = process.env.connectionStringLocal;
const dbname = process.env.DBNAME;

encrypt();

async function encrypt() {
  const client = new MongoClient(connectionString);
  await client.connect().catch(function () {
    console.log('503 - Database connection error');
  });
  const collection = client.db(dbname).collection('mail');
  const rq = collection.find().project({ password: 1 }).toArray();
  rq.then(function (data) {
    const promises = [];
    for (const item of data) {
      // Controlo se la password corrente è già in formato bcrypt
      // Le stringhe bcrypt inizano con $2[ayb]$10$ e sono lunghe 60
      const regex = new RegExp('^\\$2[ayb]\\$10\\$.{53}$');
      if (!regex.test(item.password)) {
        const _id = new ObjectId(item._id);
        const hashedPassword = bcrypt.hashSync(item.password, 10);
        const promise = collection.updateOne({ _id }, { $set: { password: hashedPassword } });
        promises.push(promise);
        console.log('Aggiornamento in corso...', item);
      }
    }

    const request = Promise.all(promises);
    request.then(function (results) {
      console.log('Aggiornamento eseguito correttamente', promises.length);
    });
    request.catch(function (err) {
      console.log('Errore aggiornamento', err.message);
    });
    request.finally(function () {
      client.close();
    });
  });
  rq.catch(function (err) {
    console.log('Errore lettura record ' + err.message);
    client.close();
  });
}
