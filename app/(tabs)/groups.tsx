import { useState, useCallback } from 'react'
import {
  View, Text, StyleSheet, FlatList, ScrollView,
  TouchableOpacity, TextInput, Modal, Alert, ActivityIndicator
} from 'react-native'
import { useRouter, useFocusEffect } from 'expo-router'
import { supabase } from '../../lib/supabase'
import { Ionicons } from '@expo/vector-icons'

export default function GroupsScreen() {
  const [groups, setGroups] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const router = useRouter()

  // Create group modal — 2 steps
  const [modalVisible, setModalVisible] = useState(false)
  const [createStep, setCreateStep] = useState<1 | 2>(1)
  const [newGroupName, setNewGroupName] = useState('')
  const [creating, setCreating] = useState(false)

  // Member adding state
  const [knownPeople, setKnownPeople] = useState<any[]>([])  // people from past groups
  const [selectedPeople, setSelectedPeople] = useState<any[]>([])  // picked from known list
  const [emailInput, setEmailInput] = useState('')
  const [addingEmail, setAddingEmail] = useState(false)
  const [pendingEmails, setPendingEmails] = useState<{ email: string; userId: string; name: string }[]>([])

  useFocusEffect(
    useCallback(() => { fetchGroups() }, [])
  )

  async function fetchGroups() {
    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const { data, error } = await supabase
      .from('group_members')
      .select('group_id, groups(id, name, created_at)')
      .eq('user_id', user.id)

    if (error) Alert.alert('Error', error.message)
    else setGroups(data?.map(d => d.groups).filter(Boolean) || [])
    setLoading(false)
  }

  // Load everyone the current user has ever shared a group with
  async function loadKnownPeople() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    // Get all groups this user is in
    const { data: myGroups } = await supabase
      .from('group_members')
      .select('group_id')
      .eq('user_id', user.id)

    if (!myGroups || myGroups.length === 0) return

    const groupIds = myGroups.map(g => g.group_id)

    // Get all members of those groups (excluding current user)
    const { data: allMembers } = await supabase
      .from('group_members')
      .select('user_id, profiles(id, full_name)')
      .in('group_id', groupIds)
      .neq('user_id', user.id)

    if (!allMembers) return

    // Deduplicate by user_id
    const seen = new Set()
    const unique = allMembers
      .filter(m => m.profiles)
      .filter(m => {
        if (seen.has(m.user_id)) return false
        seen.add(m.user_id)
        return true
      })
      .map(m => ({ id: m.user_id, full_name: (m.profiles as any).full_name }))

    setKnownPeople(unique)
  }

  function openCreateModal() {
    setCreateStep(1)
    setNewGroupName('')
    setSelectedPeople([])
    setPendingEmails([])
    setEmailInput('')
    setModalVisible(true)
    loadKnownPeople()
  }

  function togglePerson(person: any) {
    setSelectedPeople(prev =>
      prev.find(p => p.id === person.id)
        ? prev.filter(p => p.id !== person.id)
        : [...prev, person]
    )
  }

  async function addByEmail() {
    const cleaned = emailInput.trim().toLowerCase()
    if (!cleaned) return
    setAddingEmail(true)

    const { data: userId, error } = await supabase
      .rpc('get_user_id_by_email', { user_email: cleaned })

    if (error || !userId) {
      Alert.alert('Not found', 'No SplitSmart account found with that email.')
      setAddingEmail(false)
      return
    }

    // Already in selected or pending?
    if (
      selectedPeople.find(p => p.id === userId) ||
      pendingEmails.find(p => p.userId === userId)
    ) {
      Alert.alert('Already added', 'This person is already in your list.')
      setAddingEmail(false)
      return
    }

    const { data: profile } = await supabase
      .from('profiles').select('full_name').eq('id', userId).single()

    setPendingEmails(prev => [...prev, {
      email: cleaned,
      userId,
      name: profile?.full_name || cleaned,
    }])
    setEmailInput('')
    setAddingEmail(false)
  }

  async function createGroup() {
    if (!newGroupName.trim()) return
    setCreating(true)

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    // 1. Create the group
    const { data: group, error } = await supabase
      .from('groups')
      .insert({ name: newGroupName.trim(), created_by: user.id })
      .select()
      .single()

    if (error) { Alert.alert('Error', error.message); setCreating(false); return }

    // 2. Add creator
    await supabase.from('group_members').insert({ group_id: group.id, user_id: user.id, role: 'admin' })

    // 3. Add selected people from known list
    for (const person of selectedPeople) {
      await supabase.from('group_members').insert({
        group_id: group.id, user_id: person.id, role: 'member'
      })
    }

    // 4. Add people added by email
    for (const p of pendingEmails) {
      await supabase.from('group_members').insert({
        group_id: group.id, user_id: p.userId, role: 'member'
      })
    }

    setCreating(false)
    setModalVisible(false)
    fetchGroups()
    // Navigate straight into the new group
    router.push(`/(tabs)/group/${group.id}`)
  }

  const totalSelected = selectedPeople.length + pendingEmails.length

  if (loading) return (
    <View style={styles.centered}>
      <ActivityIndicator size="large" color="#1DB954" />
    </View>
  )

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Groups</Text>
        <TouchableOpacity style={styles.addBtn} onPress={openCreateModal}>
          <Ionicons name="add" size={24} color="#fff" />
        </TouchableOpacity>
      </View>

      {groups.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="people-outline" size={64} color="#ddd" />
          <Text style={styles.emptyText}>No groups yet</Text>
          <Text style={styles.emptySubtext}>Create a group to start splitting bills</Text>
          <TouchableOpacity style={styles.createBtn} onPress={openCreateModal}>
            <Text style={styles.createBtnText}>Create your first group</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={groups}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.groupCard}
              onPress={() => router.push(`/(tabs)/group/${item.id}`)}
            >
              <View style={styles.groupAvatar}>
                <Text style={styles.groupAvatarText}>{item.name[0].toUpperCase()}</Text>
              </View>
              <View style={styles.groupInfo}>
                <Text style={styles.groupName}>{item.name}</Text>
                <Text style={styles.groupDate}>
                  Created {new Date(item.created_at).toLocaleDateString()}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color="#ccc" />
            </TouchableOpacity>
          )}
          contentContainerStyle={{ paddingBottom: 20 }}
        />
      )}

      {/* ── Create Group Modal ─────────────────────────────────────── */}
      <Modal visible={modalVisible} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modal}>

            {/* Step indicator */}
            <View style={styles.stepRow}>
              <View style={[styles.stepDot, createStep >= 1 && styles.stepDotActive]} />
              <View style={[styles.stepLine, createStep >= 2 && styles.stepLineActive]} />
              <View style={[styles.stepDot, createStep >= 2 && styles.stepDotActive]} />
            </View>

            {/* ── STEP 1: Name ── */}
            {createStep === 1 && (
              <>
                <Text style={styles.modalTitle}>New Group</Text>
                <Text style={styles.modalSub}>Give your group a name</Text>
                <TextInput
                  style={styles.modalInput}
                  placeholder="e.g. Roommates, Road Trip, Dinner Squad"
                  value={newGroupName}
                  onChangeText={setNewGroupName}
                  autoFocus
                  returnKeyType="next"
                  onSubmitEditing={() => { if (newGroupName.trim()) setCreateStep(2) }}
                />
                <TouchableOpacity
                  style={[styles.modalBtn, !newGroupName.trim() && styles.modalBtnDisabled]}
                  onPress={() => { if (newGroupName.trim()) setCreateStep(2) }}
                  disabled={!newGroupName.trim()}
                >
                  <Text style={styles.modalBtnText}>Next: Add Members →</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setModalVisible(false)}>
                  <Text style={styles.cancelText}>Cancel</Text>
                </TouchableOpacity>
              </>
            )}

            {/* ── STEP 2: Members ── */}
            {createStep === 2 && (
              <ScrollView showsVerticalScrollIndicator={false}>
                <TouchableOpacity onPress={() => setCreateStep(1)} style={styles.backBtn}>
                  <Ionicons name="arrow-back" size={18} color="#999" />
                  <Text style={styles.backBtnText}>Back</Text>
                </TouchableOpacity>

                <Text style={styles.modalTitle}>Add Members</Text>
                <Text style={styles.modalSub}>
                  to <Text style={{ fontWeight: '700', color: '#1a1a1a' }}>{newGroupName}</Text>
                </Text>

                {/* Known people quick-select */}
                {knownPeople.length > 0 && (
                  <>
                    <Text style={styles.sectionLabel}>Your people</Text>
                    <Text style={styles.sectionHint}>Tap to add from people you've split with before</Text>
                    <View style={styles.peopleGrid}>
                      {knownPeople.map(person => {
                        const selected = !!selectedPeople.find(p => p.id === person.id)
                        return (
                          <TouchableOpacity
                            key={person.id}
                            style={[styles.personChip, selected && styles.personChipSelected]}
                            onPress={() => togglePerson(person)}
                          >
                            <View style={[styles.personAvatar, selected && styles.personAvatarSelected]}>
                              <Text style={styles.personAvatarText}>
                                {person.full_name?.[0]?.toUpperCase() || '?'}
                              </Text>
                            </View>
                            <Text style={[styles.personName, selected && styles.personNameSelected]} numberOfLines={1}>
                              {person.full_name?.split(' ')[0] || 'User'}
                            </Text>
                            {selected && (
                              <Ionicons name="checkmark-circle" size={16} color="#1DB954" />
                            )}
                          </TouchableOpacity>
                        )
                      })}
                    </View>
                  </>
                )}

                {/* Add by email */}
                <Text style={styles.sectionLabel}>Add by email</Text>
                <View style={styles.emailRow}>
                  <TextInput
                    style={styles.emailInput}
                    placeholder="friend@email.com"
                    value={emailInput}
                    onChangeText={setEmailInput}
                    keyboardType="email-address"
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                  <TouchableOpacity
                    style={[styles.emailAddBtn, (!emailInput.trim() || addingEmail) && styles.modalBtnDisabled]}
                    onPress={addByEmail}
                    disabled={!emailInput.trim() || addingEmail}
                  >
                    {addingEmail
                      ? <ActivityIndicator size="small" color="#fff" />
                      : <Ionicons name="add" size={22} color="#fff" />
                    }
                  </TouchableOpacity>
                </View>

                {/* Pending email-added people */}
                {pendingEmails.map((p, i) => (
                  <View key={i} style={styles.pendingRow}>
                    <View style={styles.personAvatar}>
                      <Text style={styles.personAvatarText}>{p.name[0]?.toUpperCase()}</Text>
                    </View>
                    <Text style={styles.pendingName}>{p.name}</Text>
                    <Text style={styles.pendingEmail}>{p.email}</Text>
                    <TouchableOpacity onPress={() => setPendingEmails(prev => prev.filter((_, j) => j !== i))}>
                      <Ionicons name="close-circle" size={20} color="#ccc" />
                    </TouchableOpacity>
                  </View>
                ))}

                {/* Summary */}
                <View style={styles.memberSummary}>
                  <Ionicons name="people" size={16} color="#1DB954" />
                  <Text style={styles.memberSummaryText}>
                    You + {totalSelected} member{totalSelected !== 1 ? 's' : ''}
                    {totalSelected === 0 ? ' (just you for now)' : ''}
                  </Text>
                </View>

                <TouchableOpacity
                  style={[styles.modalBtn, creating && styles.modalBtnDisabled]}
                  onPress={createGroup}
                  disabled={creating}
                >
                  <Text style={styles.modalBtnText}>
                    {creating ? 'Creating...' : `Create Group${totalSelected > 0 ? ` with ${totalSelected + 1} people` : ''}`}
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity onPress={() => setModalVisible(false)}>
                  <Text style={styles.cancelText}>Cancel</Text>
                </TouchableOpacity>
              </ScrollView>
            )}

          </View>
        </View>
      </Modal>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, paddingTop: 60 },
  title: { fontSize: 28, fontWeight: 'bold', color: '#1a1a1a' },
  addBtn: { backgroundColor: '#1DB954', width: 40, height: 40, borderRadius: 20, justifyContent: 'center', alignItems: 'center' },

  empty: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 40 },
  emptyText: { fontSize: 20, fontWeight: '600', color: '#333', marginTop: 16 },
  emptySubtext: { fontSize: 15, color: '#999', textAlign: 'center', marginTop: 8, marginBottom: 24 },
  createBtn: { backgroundColor: '#1DB954', paddingHorizontal: 24, paddingVertical: 14, borderRadius: 12 },
  createBtnText: { color: '#fff', fontWeight: '600', fontSize: 16 },

  groupCard: { flexDirection: 'row', alignItems: 'center', padding: 16, marginHorizontal: 16, marginTop: 10, backgroundColor: '#f9f9f9', borderRadius: 14 },
  groupAvatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: '#1DB954', justifyContent: 'center', alignItems: 'center' },
  groupAvatarText: { color: '#fff', fontSize: 20, fontWeight: 'bold' },
  groupInfo: { flex: 1, marginLeft: 14 },
  groupName: { fontSize: 17, fontWeight: '600', color: '#1a1a1a' },
  groupDate: { fontSize: 13, color: '#999', marginTop: 2 },

  // Modal
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modal: {
    backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: 24, paddingBottom: 48, maxHeight: '90%',
  },
  stepRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginBottom: 20 },
  stepDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#e0e0e0' },
  stepDotActive: { backgroundColor: '#1DB954' },
  stepLine: { width: 40, height: 2, backgroundColor: '#e0e0e0', marginHorizontal: 6 },
  stepLineActive: { backgroundColor: '#1DB954' },

  modalTitle: { fontSize: 22, fontWeight: 'bold', color: '#1a1a1a', marginBottom: 4 },
  modalSub: { fontSize: 14, color: '#999', marginBottom: 20 },
  modalInput: { borderWidth: 1.5, borderColor: '#e0e0e0', borderRadius: 12, padding: 16, fontSize: 16, marginBottom: 16 },
  modalBtn: { backgroundColor: '#1DB954', padding: 16, borderRadius: 12, alignItems: 'center', marginBottom: 12 },
  modalBtnDisabled: { backgroundColor: '#ccc' },
  modalBtnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  cancelText: { textAlign: 'center', color: '#999', fontSize: 15, paddingVertical: 8 },

  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 12 },
  backBtnText: { fontSize: 14, color: '#999' },

  sectionLabel: { fontSize: 13, fontWeight: '700', color: '#555', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 4, marginTop: 8 },
  sectionHint: { fontSize: 12, color: '#aaa', marginBottom: 12 },

  // People grid
  peopleGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 20 },
  personChip: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderWidth: 1.5, borderColor: '#e0e0e0', borderRadius: 24,
    paddingHorizontal: 12, paddingVertical: 8, backgroundColor: '#fafafa',
  },
  personChipSelected: { borderColor: '#1DB954', backgroundColor: '#e8f9ee' },
  personAvatar: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: '#1DB954', justifyContent: 'center', alignItems: 'center',
  },
  personAvatarSelected: { backgroundColor: '#159c3e' },
  personAvatarText: { color: '#fff', fontWeight: '700', fontSize: 12 },
  personName: { fontSize: 14, color: '#333', maxWidth: 70 },
  personNameSelected: { color: '#1DB954', fontWeight: '600' },

  // Email add
  emailRow: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  emailInput: {
    flex: 1, borderWidth: 1.5, borderColor: '#e0e0e0',
    borderRadius: 12, padding: 14, fontSize: 15,
  },
  emailAddBtn: {
    backgroundColor: '#1DB954', width: 50, borderRadius: 12,
    justifyContent: 'center', alignItems: 'center',
  },

  // Pending added people
  pendingRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#f9f9f9', borderRadius: 12,
    padding: 12, marginBottom: 8,
  },
  pendingName: { flex: 1, fontSize: 15, fontWeight: '600', color: '#1a1a1a' },
  pendingEmail: { fontSize: 12, color: '#999' },

  // Summary
  memberSummary: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#e8f9ee', borderRadius: 10,
    padding: 12, marginVertical: 16,
  },
  memberSummaryText: { fontSize: 14, color: '#1DB954', fontWeight: '500' },
})
