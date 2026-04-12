import { View, Text, StyleSheet } from 'react-native'

export default function ActivityScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Activity</Text>
      <Text style={styles.subtitle}>Your recent transactions will appear here</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#fff' },
  title: { fontSize: 24, fontWeight: 'bold', color: '#1DB954' },
  subtitle: { fontSize: 16, color: '#999', marginTop: 8, textAlign: 'center', paddingHorizontal: 40 }
})