package com.scima.learning.ui.discovery

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.LiveData
import androidx.lifecycle.MutableLiveData
import androidx.lifecycle.viewModelScope
import com.scima.learning.model.Deck
import com.scima.learning.repository.DiscoveryRepository
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.launch

class DiscoveryViewModel(application: Application) : AndroidViewModel(application) {
    
    private val repository = DiscoveryRepository()
    
    private val _decks = MutableLiveData<List<Deck>>()
    val decks: LiveData<List<Deck>> = _decks
    
    private val _isLoading = MutableLiveData<Boolean>(false)
    val isLoading: LiveData<Boolean> = _isLoading
    
    private val _error = MutableLiveData<String?>()
    val error: LiveData<String?> = _error
    
    fun loadFeaturedDecks() {
        viewModelScope.launch {
            _isLoading.value = true
            _error.value = null
            try {
                repository.getFeaturedDecks().collectLatest { deckList ->
                    _decks.value = deckList
                }
            } catch (e: Exception) {
                _error.value = e.message ?: "Failed to load decks"
            } finally {
                _isLoading.value = false
            }
        }
    }
    
    fun searchDecks(query: String) {
        if (query.isBlank()) {
            loadFeaturedDecks()
            return
        }
        
        viewModelScope.launch {
            _isLoading.value = true
            _error.value = null
            try {
                repository.searchDecks(query).collectLatest { deckList ->
                    _decks.value = deckList
                }
            } catch (e: Exception) {
                _error.value = e.message ?: "Search failed"
            } finally {
                _isLoading.value = false
            }
        }
    }
    
    fun downloadDeck(deck: Deck) {
        viewModelScope.launch {
            try {
                repository.downloadDeck(deck)
                _error.value = null
            } catch (e: Exception) {
                _error.value = "Failed to download deck: ${e.message}"
            }
        }
    }
}
