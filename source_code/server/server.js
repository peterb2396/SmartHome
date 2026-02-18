require('dotenv').config();
const express    = require('express');
const cors       = require('cors');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');

const api = require('./api');

const app = express();

app.use(cors());
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

app.use('/', api);

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Home Server running on port ${PORT}`);
});
