---
title: React Native app guide
group: Guides
description: Build real cross-platform mobile apps for iOS and Android using Expo.
---

# React Native app guide

^ Want to build an app that runs natively on your phone? React Native and Expo give you a fast workflow with hot-reloading on physical devices.

## 1. Create your Expo project

Run this in your terminal:

```bash
npx create-expo-app my-mobile-app
cd my-mobile-app
npx expo start
```

Scan the terminal QR code with the **Expo Go** app on your iPhone or Android phone to test your app live as you write code.

## 2. Building a screen

Create a clean screen with native layout components:

```javascript
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useState } from 'react';

export default function App() {
  const [count, setCount] = useState(0);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Pixl Mobile</Text>
      <Text style={styles.counter}>Count: {count}</Text>
      <TouchableOpacity 
        style={styles.button} 
        onPress={() => setCount(count + 1)}
      >
        <Text style={styles.buttonText}>Tap Me</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#121110',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20
  },
  title: { fontSize: 24, fontWeight: 'bold', color: '#f5eedc', marginBottom: 12 },
  counter: { fontSize: 18, color: '#e5a93c', marginBottom: 20 },
  button: { backgroundColor: '#e5a93c', paddingHorizontal: 24, paddingVertical: 12, borderRadius: 8 },
  buttonText: { color: '#121110', fontWeight: 'bold' }
});
```

## 3. Local data persistence

Use `@react-native-async-storage/async-storage` to save data across app restarts:

```javascript
import AsyncStorage from '@react-native-async-storage/async-storage';

// Saving data
await AsyncStorage.setItem('@saved_data', JSON.stringify({ level: 5 }));

// Loading data
const jsonValue = await AsyncStorage.getItem('@saved_data');
const data = jsonValue != null ? JSON.parse(jsonValue) : null;
```

## 4. Submitting your build

For your Pixl ship, record a quick video demo of the app running on your phone or provide an Expo snack / test build link alongside your GitHub repository.
