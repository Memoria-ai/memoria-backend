const jwt = require('jsonwebtoken');
const CryptoJS = require('crypto-js');
require('dotenv').config();
const { supabase } = require("./supabaseClient");

const encryptData = (data, secretKey) => {
    const ciphertext = CryptoJS.AES.encrypt(data, secretKey).toString();
    return ciphertext;
  };
  const decryptData = (ciphertext, secretKey) => {
    const originalText = CryptoJS.AES.decrypt(ciphertext, secretKey).toString(
      CryptoJS.enc.Utf8
    );
    return originalText;
  };
  const authenticateAndAuthorize = async (req, res, next) => {
    const authHeader = req.headers['authorization'];
    if (!authHeader) {
      return res.status(401).json({ message: 'Unauthorized' });
    }
    try {
      const token = authHeader;
      next();
    } catch (error) {
      console.error('Error verifying JWT:', error);
      return res.status(401).json({ message: 'Unauthorized' });
    }
  };


  

  const generateJwtToken = (userId) => {
    const payload = {
      sub: userId,
    };
    const token = jwt.sign(payload, process.env.JWT_SECRET, {
      expiresIn: '1h', 
    });
  
    return token;
  };

  module.exports = { encryptData, decryptData, authenticateAndAuthorize, generateJwtToken };