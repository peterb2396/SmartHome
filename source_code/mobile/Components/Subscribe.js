import React , {useState} from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Linking,
} from 'react-native';
import Purchases from 'react-native-purchases';



const Subscribe = ({ subscribed, purchase, product, simple }) => {
  const [price, setPrice] = useState('')

  async function getProduct()
  {
    // Store the product data
    let products = await Purchases.getProducts(['cards']);
    let product = products[0]

    if ('introPrice' in product && product['introPrice'])
    {
      setPrice(product['introPrice']['priceString'])
    }
    else
    {
      setPrice(product['priceString'])
    }
  }
  getProduct()
  if (simple)
  {
    return (<TouchableOpacity onPress={() => purchase()} style={styles.subscribeButton}>
    <Text style={styles.buttonText}>Subscribe: {price}</Text>
  </TouchableOpacity>)
  }
  return (
    
    <View style={[styles.container, subscribed ? styles.activeContainer : null]}>
      {subscribed ? (
        <>
          <Text style={styles.activeText}>Subscription Active</Text>
        </>
      ) : (
        <>
        <Text style={styles.inactiveText}>Get 2000 tokens per month</Text>

        <View style = {styles.terms}>
          
          <TouchableOpacity onPress={() => Linking.openURL('https://www.apple.com/legal/internet-services/itunes/dev/stdeula/')} style={styles.button}>
            <Text style={styles.buttonTextTerms}>Terms</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => purchase()} style={styles.subscribeButton}>
            <Text style={styles.buttonText}>Subscribe: {price}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => Linking.openURL('https://www.freeprivacypolicy.com/live/e1017c14-2f48-423c-9598-a306e394c30a')} style={styles.button}>
            <Text style={styles.buttonTextTerms}>Privacy</Text>
          </TouchableOpacity>
        </View>
        </>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#000',
    padding: 10,
    alignItems: 'center',
  },
  activeContainer: {
    backgroundColor: '#8BC34A', // Green color for active subscription
  },
  activeText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#fff', // White color for text in active subscription
  },
  checkmarkImage: {
    width: 20,
    height: 20,
    marginVertical: 8,
  },
  inactiveText: {
    fontSize: 13,
  },
  subscribeButton: {
    backgroundColor: '#2196F3', // Blue color for Subscribe button
    borderRadius: 4,
    paddingVertical: 8,
    paddingHorizontal: 8,
    marginTop: 8,
    marginHorizontal: 8
  },
  buttonText: {
    color: '#fff', // White color for text on the button
    fontSize: 14,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  buttonTextTerms: {
    color: '#fff', // White color for text on the button
    fontSize: 10,
    textAlign: 'center',
  },
  terms: {
    flexDirection: 'row', // Arrange children horizontally
    justifyContent: 'space-between', // Evenly distribute space between children
   
  },
  button: {
    backgroundColor: '#2196F3', // Blue color for Subscribe button
    borderRadius: 4,
    paddingVertical: 8,
    paddingHorizontal: 16,
    marginTop: 8,
    justifyContent: 'center', 
  },
});

export default Subscribe;
