export default ({ node }) => {
  let state = {
    loading: false,

    // our delegations, maybe not yet committed
    delegates: [],

    // our delegations which are already on the blockchain
    committedDelegates: {},
    unbondingDelegations: {}
  }

  const mutations = {
    addToCart(state, delegate) {
      // don't add to cart if already in cart
      for (let existingDelegate of state.delegates) {
        if (delegate.id === existingDelegate.id) return
      }

      state.delegates.push({
        id: delegate.id,
        delegate: Object.assign({}, delegate),
        atoms: 0
      })
    },
    removeFromCart(state, delegate) {
      state.delegates = state.delegates.filter(c => c.id !== delegate)
    },
    setShares(state, { candidateId, value }) {
      state.delegates.find(c => c.id === candidateId).atoms = value
    },
    setCommittedDelegation(state, { candidateId, value }) {
      let committedDelegates = Object.assign({}, state.committedDelegates)
      if (value === 0) {
        delete committedDelegates[candidateId]
      } else {
        committedDelegates[candidateId] = value
      }
      state.committedDelegates = committedDelegates
    },
    setUnbondingDelegation(state, { candidateId, value }) {
      let unbondingDelegations = Object.assign({}, state.unbondingDelegations)
      if (value === 0) {
        delete unbondingDelegations[candidateId]
      } else {
        unbondingDelegations[candidateId] = value
      }
      state.unbondingDelegations = unbondingDelegations
    }
  }

  let actions = {
    reconnected({ state, dispatch }) {
      if (state.loading) {
        dispatch("getBondedDelegates")
      }
    },
    // load committed delegations from LCD
    async getBondedDelegates({ state, rootState, commit }, candidates) {
      state.loading = true
      let address = rootState.user.address
      candidates = candidates || (await dispatch("getDelegates"))
      let delegator = await node.getDelegator(address)
      delegator.delegations.forEach(({ validator_addr, shares }) => {
        commit("setCommittedDelegation", {
          candidateId: validator_addr,
          value: parseFloat(shares)
        })
        if (shares > 0) {
          const delegate = candidates.find(
            ({ owner }) => owner === validator_addr // this should change to address instead of owner
          )
          commit("addToCart", delegate)
        }
      })
      delegator.unbonding_delegations.forEach(
        ({ validator_addr, balance: { amount } }) => {
          commit("setUnbondingDelegation", {
            candidateId: validator_addr,
            value: parseFloat(amount)
          })
        }
      )
      state.loading = false
    },
    async updateDelegates({ dispatch }) {
      let candidates = await dispatch("getDelegates")
      return dispatch("getBondedDelegates", candidates)
    },
    async submitDelegation(
      { rootState, state, dispatch, commit },
      delegations
    ) {
      let delegate = []
      let unbond = []
      for (let delegation of delegations) {
        let candidateId = delegation.delegate.owner
        let currentlyDelegated =
          parseInt(state.committedDelegates[candidateId]) || 0
        let amountChange = parseInt(delegation.atoms) - currentlyDelegated

        let isBond = amountChange > 0

        // skip if no change
        if (amountChange === 0) continue
        if (isBond) {
          delegate.push({
            delegator_addr: rootState.wallet.address,
            validator_addr: candidateId,
            delegation: {
              denom: rootState.config.bondingDenom,
              amount: String(amountChange)
            }
          })
        } else {
          unbond.push({
            delegator_addr: rootState.wallet.address,
            validator_addr: candidateId,
            shares: String(Math.abs(amountChange))
          })
        }
      }

      await dispatch("sendTx", {
        type: "updateDelegations",
        to: rootState.wallet.address, // TODO strange syntax
        delegations: delegate,
        begin_unbondings: unbond
      })

      // usually I would just query the new state through the LCD but at this point we still get the old shares
      dispatch("updateDelegates").then(() => {
        for (let delegation of delegations) {
          commit("setCommittedDelegation", {
            candidateId: delegation.delegate.owner,
            value: delegation.atoms
          })
        }
      })
    }
  }

  return {
    state,
    mutations,
    actions
  }
}
